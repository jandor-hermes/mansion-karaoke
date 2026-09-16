import AppKit
import Foundation

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
    let controllerExecutable: Bool
    let extensionManifest: Bool
}

private func bundledControllerURL() -> URL? {
    Bundle.main.resourceURL?.appendingPathComponent(controllerName)
}

private func bundledExtensionURL() -> URL? {
    Bundle.main.resourceURL?.appendingPathComponent(extensionDirectoryName, isDirectory: true)
}

private func loadOrCreateToken(in applicationSupportURL: URL) throws -> String {
    let tokenURL = applicationSupportURL.appendingPathComponent("party-token")
    if FileManager.default.fileExists(atPath: tokenURL.path) {
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: tokenURL.path)
        if let existing = try? String(contentsOf: tokenURL, encoding: .utf8)
            .trimmingCharacters(in: .whitespacesAndNewlines), !existing.isEmpty {
            return existing
        }
    }
    let token = (UUID().uuidString + UUID().uuidString).replacingOccurrences(of: "-", with: "").lowercased()
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
    if let supportPath = ProcessInfo.processInfo.environment["MANSION_KARAOKE_SELF_TEST_SUPPORT_DIR"] {
        let supportURL = URL(fileURLWithPath: supportPath, isDirectory: true)
        try FileManager.default.createDirectory(at: supportURL, withIntermediateDirectories: true)
        _ = try loadOrCreateToken(in: supportURL)
        let log = try prepareControllerLog(in: supportURL)
        try log.close()
    }
    let controller = bundledControllerURL()
    let manifest = bundledExtensionURL()?.appendingPathComponent("manifest.json")
    let report = SelfTestReport(
        bundleIdentifier: Bundle.main.bundleIdentifier ?? "",
        controllerPort: controllerPort,
        controllerExecutable: controller.map { FileManager.default.isExecutableFile(atPath: $0.path) } ?? false,
        extensionManifest: manifest.map { FileManager.default.fileExists(atPath: $0.path) } ?? false
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
    private let loopbackURL = URL(string: "http://127.0.0.1:\(controllerPort)/")!

    func applicationDidFinishLaunching(_ notification: Notification) {
        do {
            try prepareApplicationSupport()
            partyToken = try loadOrCreateToken(in: applicationSupportURL)
            try installExtensionCopy()
            buildMenu()
            buildWindow()
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
                self?.closeControllerLog()
                self?.statusLabel?.stringValue = "Stopped (exit \(process.terminationStatus)). See controller.log for details."
                self?.statusLabel?.textColor = .systemRed
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
            "Firefox setup\n1. Click Firefox Setup, then choose This Firefox.\n2. Click Load Temporary Add-on.\n3. Select the revealed manifest.json file.\n4. Open the Mansion Karaoke toolbar button and enter the URL and token above.\n5. Click Save & start. Guests can then scan the QR code on the TV.",
            frame: NSRect(x: 28, y: 70, width: 584, height: 135),
            size: 13,
            bold: false
        )
        instructions.maximumNumberOfLines = 7
        content.addSubview(instructions)

        extensionPathField = selectableField(installedExtensionURL.appendingPathComponent("manifest.json").path, frame: NSRect(x: 28, y: 28, width: 584, height: 28))
        extensionPathField.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        content.addSubview(extensionPathField)

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
        let manifest = installedExtensionURL.appendingPathComponent("manifest.json")
        NSWorkspace.shared.activateFileViewerSelecting([manifest])
    }

    @objc private func openFirefoxSetup() {
        guard let firefox = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "org.mozilla.firefox"),
              let setup = URL(string: "about:debugging#/runtime/this-firefox") else {
            let alert = NSAlert()
            alert.messageText = "Firefox was not found"
            alert.informativeText = "Install Firefox, then reopen Mansion Karaoke."
            alert.runModal()
            return
        }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        NSWorkspace.shared.open([setup], withApplicationAt: firefox, configuration: configuration)
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
