const { withDangerousMod, withPlugins } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const PATCH_SNIPPET = `  # ── Fix fmt consteval compile error with Xcode 26 ──
  fmt_header = File.join(installer.sandbox.root, "fmt", "include", "fmt", "base.h")
  if File.exist?(fmt_header)
    content = File.read(fmt_header)
    unless content.include?("FMT_USE_CONSTEVAL 0  # patched")
      File.chmod(0644, fmt_header)
      content.sub!("// Formatting library for C++ - the base API for char/UTF-8", "// Formatting library for C++ - the base API for char/UTF-8\n#define FMT_USE_CONSTEVAL 0  // patched for Xcode 26 compat")
      File.write(fmt_header, content)
    end
  end
`;

/**
 * Fix Xcode 26 / iOS SDK 26 compile error in the fmt library.
 * Injects the fmt header patch into the EXISTING post_install block.
 */
function withFmtConstevalFix(config) {
  return withDangerousMod(config, [
    "ios",
    async (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, "Podfile");
      if (!fs.existsSync(podfilePath)) return config;

      let podfile = fs.readFileSync(podfilePath, "utf8");

      if (podfile.includes("FMT_USE_CONSTEVAL")) return config;

      // Fix Ruby 3.4 encoding issue with CocoaPods (add to top of Podfile)
      if (!podfile.includes("Encoding.default_external")) {
        podfile = "# Fix Ruby 3.4 + CocoaPods encoding issue\nENV['LANG'] ||= 'en_US.UTF-8'\nEncoding.default_external = Encoding::UTF_8\n\n" + podfile;
      }

      // Find existing post_install block and inject our patch at the end of it
      // Look for the closing "end" of the post_install block (the one from expo)
      const postInstallIdx = podfile.lastIndexOf("post_install do |installer|");
      if (postInstallIdx === -1) return config;

      // Find the matching "end" for this post_install block
      // Strategy: insert before the last "end" in the file that belongs to this block
      // Simpler: insert right before the closing "end" of the Podfile
      // Actually: find the last "end\n" line and inject before it
      const lines = podfile.split("\n");
      // Find the line with "post_install do |installer|"
      let postInstallLine = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes("post_install do |installer|")) {
          postInstallLine = i;
        }
      }
      if (postInstallLine === -1) return config;

      // Find the matching "end" by tracking depth
      let depth = 0;
      let endLine = -1;
      for (let i = postInstallLine; i < lines.length; i++) {
        const line = lines[i];
        if (line.match(/\bdo\b|\bif\b|\bunless\b/) && !line.includes("end")) depth++;
        if (line.trim() === "end") depth--;
        if (depth === 0 && i > postInstallLine) { endLine = i; break; }
      }
      if (endLine === -1) return config;

      // Insert our patch before the closing "end"
      const patchLines = PATCH_SNIPPET.split("\n");
      lines.splice(endLine, 0, ...patchLines);

      fs.writeFileSync(podfilePath, lines.join("\n"));
      return config;
    },
  ]);
}

module.exports = function withBuildFixes(config) {
  return withPlugins(config, [withFmtConstevalFix]);
};
