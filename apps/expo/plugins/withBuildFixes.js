const { withDangerousMod, withPlugins } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

/**
 * Fix Xcode 26 / iOS SDK 26 compile error in the fmt library.
 * Injects FMT_USE_CONSTEVAL=0 into all Pod target build settings.
 */
function withFmtConstevalFix(config) {
  return withDangerousMod(config, [
    "ios",
    async (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, "Podfile");
      if (!fs.existsSync(podfilePath)) return config;

      let podfile = fs.readFileSync(podfilePath, "utf8");

      if (!podfile.includes("FMT_USE_CONSTEVAL")) {
        const injection = `
# ── Fix fmt consteval compile error with Xcode 26 / iOS SDK 26 ──
# Injects FMT_USE_CONSTEVAL=0 into all Pod target build settings.
post_install do |installer|
  installer.pods_project.targets.each do |target|
    target.build_configurations.each do |config|
      current = config.build_settings["GCC_PREPROCESSOR_DEFINITIONS"]
      defs = if current.is_a?(Array)
               current.dup
             elsif current.is_a?(String)
               [current]
             else
               ["$(inherited)"]
             end
      unless defs.any? { |d| d.to_s.include?("FMT_USE_CONSTEVAL") }
        defs << "FMT_USE_CONSTEVAL=0"
      end
      config.build_settings["GCC_PREPROCESSOR_DEFINITIONS"] = defs
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
