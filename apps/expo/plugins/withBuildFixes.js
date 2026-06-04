const { withDangerousMod, withPlugins } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

/**
 * Fix Xcode 26 / iOS SDK 26 compile error in the fmt library.
 * Xcode 26's Clang enforces consteval on FMT_STRING macros.
 * Patches fmt/core.h to disable consteval after pod install.
 */
function withFmtConstevalFix(config) {
  return withDangerousMod(config, [
    "ios",
    async (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, "Podfile");
      if (!fs.existsSync(podfilePath)) return config;

      let podfile = fs.readFileSync(podfilePath, "utf8");

      if (!podfile.includes("patch-fmt-consteval")) {
        // Inject a post_install script that patches the fmt header on disk
        const injection = `
# ── Fix fmt consteval compile error with Xcode 26 / iOS SDK 26 ──
# Patches fmt/core.h to disable consteval after pod install.
post_install do |installer|
  fmt_header = File.join(installer.sandbox.root, "fmt", "include", "fmt", "core.h")
  if File.exist?(fmt_header)
    content = File.read(fmt_header)
    unless content.include?("FMT_USE_CONSTEVAL 0")
      # Force-disable consteval before the library's own check
      content.sub!('#if defined(FMT_USE_CONSTEVAL)', '#define FMT_USE_CONSTEVAL 0' + "\n" + '#if defined(FMT_USE_CONSTEVAL)')
      File.write(fmt_header, content)
      puts "patch-fmt-consteval: patched " + fmt_header
    end
  end
end
`;
        podfile += injection;
        fs.writeFileSync(podfilePath, podfile);
      }
      return config;
    },
  ]);
}

module.exports = function withBuildFixes(config) {
  return withPlugins(config, [withFmtConstevalFix]);
};
