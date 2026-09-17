import AppKit
import Foundation
import Security

private let controllerName = "mansion-controller"
private let extensionDirectoryName = "firefox-extension"
private let bundleIdentifier = "com.mansionkaraoke.host"
private let controllerPort: Int = {
    guard let value = ProcessInfo.processInfo.environment["MANSION_KARAOKE_PORT"],
          let port = Int(value), (1...65535).contains(port) else { return 3010 }
    return port
}()

private struct SelfTestReport: Codable {
    let bundleIdentifier: String
    let controllerPort: Int
    let controllerPortAvailable: Bool
    let controllerExecutable: Bool
    let extensionManifest: Bool
    let controllerFailureMessage: String?
}

private func bundledControllerURL() -> URL? {
    Bundle.main.resourceURL?.appendingPathComponent(controllerName)
}

private func bundledExtensionURL() -> URL? {
    Bundle.main.resourceURL?.appendingPathComponent(extensionDirectoryName, isDirectory: true)
}

private func makePartyToken() throws -> String {
    let alphabet = Array("ABCDEFGHJKLMNPQRSTUVWXYZ23456789")
    var bytes = [UInt8](repeating: 0, count: 8)
    guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
        throw NSError(domain: bundleIdentifier, code: 3, userInfo: [NSLocalizedDescriptionKey: "Could not generate a secure party token."])
    }
    return String(bytes.map { alphabet[Int($0) & 31] })
}

private func isCurrentPartyToken(_ token: String) -> Bool {
    token.range(of: "^[A-HJ-NP-Z2-9]{8}$", options: .regularExpression) != nil
}

private func controllerPortIsAvailable() -> Bool {
    let descriptor = socket(AF_INET, SOCK_STREAM, 0)
    guard descriptor >= 0 else { return false }
    defer { close(descriptor) }

    var address = sockaddr_in()
    address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    address.sin_family = sa_family_t(AF_INET)
    address.sin_port = in_port_t(controllerPort).bigEndian
    address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
    let result = withUnsafePointer(to: &address) { pointer in
        pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
            connect(descriptor, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
        }
    }
    return result != 0
}

private func portConflictMessage() -> String {
    "Port \(controllerPort) is already in use. Quit the other controller or app using that port, then reopen Mansion Karaoke."
}

private func controllerFailureMessage(from applicationSupportURL: URL) -> String? {
    let logURL = applicationSupportURL.appendingPathComponent("controller.log")
    guard let log = try? String(contentsOf: logURL, encoding: .utf8) else { return nil }
    if log.localizedCaseInsensitiveContains("port \(controllerPort) in use") ||
        log.localizedCaseInsensitiveContains("address already in use") ||
        log.localizedCaseInsensitiveContains("EADDRINUSE") {
        return portConflictMessage()
    }
    return nil
}

private func loadOrCreateToken(in applicationSupportURL: URL) throws -> String {
    let tokenURL = applicationSupportURL.appendingPathComponent("party-token")
    if FileManager.default.fileExists(atPath: tokenURL.path) {
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: tokenURL.path)
        if let existing = try? String(contentsOf: tokenURL, encoding: .utf8)
            .trimmingCharacters(in: .whitespacesAndNewlines), isCurrentPartyToken(existing) {
            return existing
        }
    }
    let token = try makePartyToken()
    try token.write(to: tokenURL, atomically: true, encoding: .utf8)
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: tokenURL.path)
    return token
}

private func prepareControllerLog(in applicationSupportURL: URL) throws -> FileHandle {
    let logURL = applicationSupportURL.appendingPathComponent("controller.log")
    if !FileManager.default.fileExists(atPath: logURL.path) {
        FileManager.default.createFile(atPath: logURL.path, contents: nil)
    }
    let log = try FileHandle(forWritingTo: logURL)
    try log.truncate(atOffset: 0)
    return log
}

if CommandLine.arguments.contains("--self-test") {
    var failureMessage: String?
    if let supportPath = ProcessInfo.processInfo.environment["MANSION_KARAOKE_SELF_TEST_SUPPORT_DIR"] {
        let supportURL = URL(fileURLWithPath: supportPath, isDirectory: true)
        try FileManager.default.createDirectory(at: supportURL, withIntermediateDirectories: true)
        _ = try loadOrCreateToken(in: supportURL)
        let log = try prepareControllerLog(in: supportURL)
        try log.close()
    }
    if let failurePath = ProcessInfo.processInfo.environment["MANSION_KARAOKE_SELF_TEST_FAILURE_DIR"] {
        failureMessage = controllerFailureMessage(from: URL(fileURLWithPath: failurePath, isDirectory: true))
    }
    let controller = bundledControllerURL()
    let manifest = bundledExtensionURL()?.appendingPathComponent("manifest.json")
    let report = SelfTestReport(
        bundleIdentifier: Bundle.main.bundleIdentifier ?? "",
        controllerPort: controllerPort,
        controllerPortAvailable: controllerPortIsAvailable(),
        controllerExecutable: controller.map { FileManager.default.isExecutableFile(atPath: $0.path) } ?? false,
        extensionManifest: manifest.map { FileManager.default.fileExists(atPath: $0.path) } ?? false,
        controllerFailureMessage: failureMessage
    )
    let data = try JSONEncoder().encode(report)
    print(String(decoding: data, as: UTF8.self))
    exit(report.controllerExecutable && report.extensionManifest ? 0 : 1)
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow!
    private var controller: Process?
    private var controllerLog: FileHandle?
    private var statusLabel: NSTextField!
    private var tokenField: NSTextField!
    private var guestURLField: NSTextField!
    private var extensionPathField: NSTextField!
    private var partyToken = ""
    private var applicationSupportURL: URL!
    private var installedExtensionURL: URL!
    private var easyManifestURL: URL!
    private let loopbackURL = URL(string: "http://127.0.0.1:\(controllerPort)/")!

    func applicationDidFinishLaunching(_ notification: Notification) {
        do {
            try prepareApplicationSupport()
            partyToken = try loadOrCreateToken(in: applicationSupportURL)
            try installExtensionCopy()
            easyManifestURL = prepareEasyManifestLocation()
            buildMenu()
            buildWindow()
            guard controllerPortIsAvailable() else {
                throw NSError(
                    domain: bundleIdentifier,
                    code: 4,
                    userInfo: [NSLocalizedDescriptionKey: portConflictMessage()]
                )
            }
            try startController()
            checkController(attempt: 0)
        } catch {
            showFatalError(error.localizedDescription)
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func applicationWillTerminate(_ notification: Notification) {
        if let process = controller, process.isRunning {
            process.terminate()
            let deadline = Date().addingTimeInterval(2)
            while process.isRunning && Date() < deadline {
                RunLoop.current.run(until: Date().addingTimeInterval(0.05))
            }
            if process.isRunning {
                kill(process.processIdentifier, SIGKILL)
                process.waitUntilExit()
            }
        }
        closeControllerLog()
    }

    private func prepareApplicationSupport() throws {
        let base = try FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        applicationSupportURL = base.appendingPathComponent("Mansion Karaoke", isDirectory: true)
        try FileManager.default.createDirectory(at: applicationSupportURL, withIntermediateDirectories: true)
        installedExtensionURL = applicationSupportURL.appendingPathComponent(extensionDirectoryName, isDirectory: true)
    }


    private func installExtensionCopy() throws {
        guard let source = bundledExtensionURL() else {
            throw NSError(domain: bundleIdentifier, code: 1, userInfo: [NSLocalizedDescriptionKey: "The bundled Firefox extension is missing."])
        }
        if FileManager.default.fileExists(atPath: installedExtensionURL.path) {
            try FileManager.default.removeItem(at: installedExtensionURL)
        }
        try FileManager.default.copyItem(at: source, to: installedExtensionURL)
    }

    private func prepareEasyManifestLocation() -> URL {
        let fallback = installedExtensionURL.appendingPathComponent("manifest.json")
        guard let desktop = try? FileManager.default.url(
            for: .desktopDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: false
        ), FileManager.default.isWritableFile(atPath: desktop.path) else { return fallback }

        let easyDirectory = desktop.appendingPathComponent("Mansion Karaoke Extension", isDirectory: true)
        do {
            if FileManager.default.fileExists(atPath: easyDirectory.path) {
                let values = try easyDirectory.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
                guard values.isDirectory == true, values.isSymbolicLink != true else { return fallback }
            } else {
                try FileManager.default.createDirectory(at: easyDirectory, withIntermediateDirectories: false)
            }
            for item in try FileManager.default.contentsOfDirectory(at: installedExtensionURL, includingPropertiesForKeys: nil) {
                let link = easyDirectory.appendingPathComponent(item.lastPathComponent)
                if FileManager.default.fileExists(atPath: link.path) {
                    let values = try link.resourceValues(forKeys: [.isSymbolicLinkKey])
                    guard values.isSymbolicLink == true else { return fallback }
                    try FileManager.default.removeItem(at: link)
                }
                try FileManager.default.createSymbolicLink(
                    at: link,
                    withDestinationURL: item
                )
            }
            return easyDirectory.appendingPathComponent("manifest.json")
        } catch {
            return fallback
        }
    }

    private func startController() throws {
        guard let executable = bundledControllerURL(), FileManager.default.isExecutableFile(atPath: executable.path) else {
            throw NSError(domain: bundleIdentifier, code: 2, userInfo: [NSLocalizedDescriptionKey: "The bundled karaoke controller is missing or not executable."])
        }

        let log = try prepareControllerLog(in: applicationSupportURL)
        controllerLog = log

        let process = Process()
        process.executableURL = executable
        process.currentDirectoryURL = applicationSupportURL
        process.environment = ProcessInfo.processInfo.environment.merging([
            "KARAOKE_TOKEN": partyToken,
            "KARAOKE_ROOM_ID": "local",
            "PORT": String(controllerPort),
        ]) { _, packaged in packaged }
        process.standardOutput = log
        process.standardError = log
        process.terminationHandler = { [weak self] process in
            DispatchQueue.main.async {
                guard let self else { return }
                self.closeControllerLog()
                let message = controllerFailureMessage(from: self.applicationSupportURL)
                    ?? "Stopped (exit \(process.terminationStatus)). See controller.log for details."
                self.statusLabel?.stringValue = message
                self.statusLabel?.textColor = .systemRed
                if controllerFailureMessage(from: self.applicationSupportURL) != nil {
                    let alert = NSAlert()
                    alert.alertStyle = .critical
                    alert.messageText = "Mansion Karaoke could not start"
                    alert.informativeText = message
                    alert.runModal()
                }
            }
        }
        do {
            try process.run()
        } catch {
            closeControllerLog()
            throw error
        }
        controller = process
    }

    private func closeControllerLog() {
        guard let log = controllerLog else { return }
        try? log.close()
        controllerLog = nil
    }

    private func checkController(attempt: Int) {
        var request = URLRequest(url: loopbackURL.appendingPathComponent("status"))
        request.setValue("Bearer \(partyToken)", forHTTPHeaderField: "Authorization")
        URLSession.shared.dataTask(with: request) { [weak self] _, response, _ in
            let ready = (response as? HTTPURLResponse)?.statusCode == 200
            DispatchQueue.main.async {
                guard let self else { return }
                if ready {
                    self.statusLabel.stringValue = "Running — phones on this Wi-Fi can join from the TV QR code."
                    self.statusLabel.textColor = .systemGreen
                    return
                }
                if attempt < 40, self.controller?.isRunning == true {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                        self.checkController(attempt: attempt + 1)
                    }
                } else if self.controller?.isRunning == true {
                    self.statusLabel.stringValue = "Controller started but did not become ready."
                    self.statusLabel.textColor = .systemOrange
                }
            }
        }.resume()
    }

    private func buildMenu() {
        let mainMenu = NSMenu()
        let appItem = NSMenuItem()
        mainMenu.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Quit Mansion Karaoke", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        NSApp.mainMenu = mainMenu
    }

    private func buildWindow() {
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 640, height: 470),
            styleMask: [.titled, .closable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Mansion Karaoke"
        window.center()
        window.isReleasedWhenClosed = false

        guard let content = window.contentView else { return }
        let title = label("Mansion Karaoke", frame: NSRect(x: 28, y: 408, width: 584, height: 34), size: 26, bold: true)
        content.addSubview(title)

        statusLabel = label("Starting controller…", frame: NSRect(x: 28, y: 375, width: 584, height: 24), size: 14, bold: true)
        statusLabel.textColor = .secondaryLabelColor
        content.addSubview(statusLabel)

        content.addSubview(label("Controller URL", frame: NSRect(x: 28, y: 329, width: 130, height: 22), size: 13, bold: true))
        guestURLField = selectableField("http://127.0.0.1:\(controllerPort)", frame: NSRect(x: 160, y: 326, width: 450, height: 26))
        content.addSubview(guestURLField)

        content.addSubview(label("Party token", frame: NSRect(x: 28, y: 287, width: 130, height: 22), size: 13, bold: true))
        tokenField = selectableField(partyToken, frame: NSRect(x: 160, y: 284, width: 450, height: 26))
        content.addSubview(tokenField)

        content.addSubview(button("Copy Token", action: #selector(copyToken), frame: NSRect(x: 28, y: 230, width: 130, height: 34)))
        content.addSubview(button("Open Party Page", action: #selector(openPartyPage), frame: NSRect(x: 170, y: 230, width: 150, height: 34)))
        content.addSubview(button("Firefox Setup", action: #selector(openFirefoxSetup), frame: NSRect(x: 332, y: 230, width: 130, height: 34)))
        content.addSubview(button("Reveal Extension", action: #selector(revealExtension), frame: NSRect(x: 474, y: 230, width: 138, height: 34)))

        let instructions = label(
            "Firefox setup\n1. Click Firefox Setup, then Load Temporary Add-on.\n2. Choose Desktop → Mansion Karaoke Extension → manifest.json.\n3. If it is not there, use Reveal Extension or Copy Manifest Path below.\n4. Open the Mansion Karaoke toolbar button and enter the URL and token above.\n5. Click Save & start. Guests can then scan the QR code on the TV.",
            frame: NSRect(x: 28, y: 70, width: 584, height: 135),
            size: 13,
            bold: false
        )
        instructions.maximumNumberOfLines = 7
        content.addSubview(instructions)

        extensionPathField = selectableField(easyManifestURL.path, frame: NSRect(x: 28, y: 28, width: 390, height: 28))
        extensionPathField.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        content.addSubview(extensionPathField)
        content.addSubview(button("Copy Manifest Path", action: #selector(copyManifestPath), frame: NSRect(x: 428, y: 27, width: 184, height: 30)))

        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func label(_ text: String, frame: NSRect, size: CGFloat, bold: Bool) -> NSTextField {
        let field = NSTextField(labelWithString: text)
        field.frame = frame
        field.font = bold ? .boldSystemFont(ofSize: size) : .systemFont(ofSize: size)
        field.lineBreakMode = .byWordWrapping
        field.maximumNumberOfLines = 0
        return field
    }

    private func selectableField(_ text: String, frame: NSRect) -> NSTextField {
        let field = NSTextField(string: text)
        field.frame = frame
        field.isEditable = false
        field.isSelectable = true
        field.isBezeled = true
        field.drawsBackground = true
        return field
    }

    private func button(_ title: String, action: Selector, frame: NSRect) -> NSButton {
        let button = NSButton(title: title, target: self, action: action)
        button.frame = frame
        button.bezelStyle = .rounded
        return button
    }

    @objc private func copyToken() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(partyToken, forType: .string)
    }

    @objc private func openPartyPage() {
        NSWorkspace.shared.open(loopbackURL)
    }

    @objc private func revealExtension() {
        NSWorkspace.shared.activateFileViewerSelecting([easyManifestURL])
    }

    @objc private func copyManifestPath() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(easyManifestURL.path, forType: .string)
    }

    @objc private func openFirefoxSetup() {
        guard let firefox = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "org.mozilla.firefox") else {
            let alert = NSAlert()
            alert.messageText = "Firefox was not found"
            alert.informativeText = "Install Firefox, then reopen Mansion Karaoke."
            alert.runModal()
            return
        }
        let executable = firefox.appendingPathComponent("Contents/MacOS/firefox")
        let process = Process()
        process.executableURL = executable
        process.arguments = ["--new-tab", "about:debugging#/runtime/this-firefox"]
        do {
            try process.run()
        } catch {
            let alert = NSAlert()
            alert.messageText = "Firefox setup could not open"
            alert.informativeText = error.localizedDescription
            alert.runModal()
        }
    }

    private func showFatalError(_ message: String) {
        let alert = NSAlert()
        alert.alertStyle = .critical
        alert.messageText = "Mansion Karaoke could not start"
        alert.informativeText = message
        alert.runModal()
        NSApp.terminate(nil)
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
