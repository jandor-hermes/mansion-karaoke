import AppKit
import CoreText
import ImageIO
import UniformTypeIdentifiers

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let iconset = root.appendingPathComponent("packaging/macos/AppIcon.iconset")
try? FileManager.default.removeItem(at: iconset)
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)

func drawIcon(size: Int) -> CGImage {
    let colorSpace = CGColorSpaceCreateDeviceRGB()
    let context = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: size * 4, space: colorSpace, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    let s = CGFloat(size)
    context.setFillColor(CGColor(red: 0.035, green: 0.035, blue: 0.06, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: s, height: s))

    let radius = s * 0.225
    let tile = CGRect(x: s * 0.035, y: s * 0.035, width: s * 0.93, height: s * 0.93)
    let path = CGPath(roundedRect: tile, cornerWidth: radius, cornerHeight: radius, transform: nil)
    context.saveGState()
    context.addPath(path)
    context.clip()
    let colors = [
        CGColor(red: 0.08, green: 0.16, blue: 0.27, alpha: 1),
        CGColor(red: 0.14, green: 0.10, blue: 0.28, alpha: 1),
        CGColor(red: 0.28, green: 0.07, blue: 0.24, alpha: 1)
    ] as CFArray
    let gradient = CGGradient(colorsSpace: colorSpace, colors: colors, locations: [0, 0.55, 1])!
    context.drawLinearGradient(gradient, start: CGPoint(x: s * 0.08, y: s * 0.92), end: CGPoint(x: s * 0.92, y: s * 0.08), options: [])
    context.restoreGState()

    context.saveGState()
    context.addPath(path)
    context.clip()
    let glow = CGGradient(colorsSpace: colorSpace, colors: [CGColor(red: 1, green: 1, blue: 1, alpha: 0.16), CGColor(red: 1, green: 1, blue: 1, alpha: 0)] as CFArray, locations: [0, 1])!
    context.drawRadialGradient(glow, startCenter: CGPoint(x: s * 0.25, y: s * 0.78), startRadius: 0, endCenter: CGPoint(x: s * 0.25, y: s * 0.78), endRadius: s * 0.7, options: [])
    context.restoreGState()

    let font = CTFontCreateWithName("Avenir Next Demi Bold" as CFString, s * 0.39, nil)
    let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: NSColor.white.cgColor]
    let line = CTLineCreateWithAttributedString(NSAttributedString(string: "MK", attributes: attributes))
    let bounds = CTLineGetBoundsWithOptions(line, [])
    let textWidth = bounds.width
    let textHeight = bounds.height
    let textX = (s - textWidth) / 2 - bounds.minX
    let textY = (s - textHeight) / 2 - bounds.minY
    context.setShadow(offset: CGSize(width: 0, height: -s * 0.012), blur: s * 0.025, color: CGColor(gray: 0, alpha: 0.35))
    context.textPosition = CGPoint(x: textX, y: textY)
    CTLineDraw(line, context)
    return context.makeImage()!
}

func writePNG(_ image: CGImage, to url: URL) throws {
    let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else { throw NSError(domain: "Icon", code: 1) }
}

for size in [16, 32, 128, 256, 512, 1024] {
    let image = drawIcon(size: size)
    try writePNG(image, to: iconset.appendingPathComponent("icon_\(size)x\(size).png"))
    if size <= 512 {
        try writePNG(drawIcon(size: size * 2), to: iconset.appendingPathComponent("icon_\(size)x\(size)@2x.png"))
    }
}
print("Generated \(iconset.path)")
