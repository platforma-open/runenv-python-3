const fs = require('fs');
const path = require('path');

/**
 * Merges shared configuration with version-specific overrides, handling deep merging of nested properties.
 * @param {string} version - Python version (e.g., "3.12.10")
 * @returns {Object} The fully merged configuration object.
 */
function mergeConfig(version) {
    // 1. Load shared and version-specific configurations
    const sharedConfigPath = path.join(__dirname, '..', 'shared-config.json');
    const sharedConfig = JSON.parse(fs.readFileSync(sharedConfigPath, 'utf8'));

    const versionConfigPath = path.join(__dirname, '..', `python-${version}`, 'config.json');
    if (!fs.existsSync(versionConfigPath)) {
        console.log(`[INFO] No version-specific config for '${version}'. Using shared config only.`);
        return sharedConfig; // Return shared config if no version-specific one exists
    }
    const versionConfig = JSON.parse(fs.readFileSync(versionConfigPath, 'utf8'));

    // 2. Manually construct the final configuration to ensure correct deep merging
    const mergedConfig = {
        // Merge 'build' object - version-specific keys override shared keys
        build: {
            ...(sharedConfig.build || {}),
            ...(versionConfig.build || {}),
        },
        // Merge 'registries' - concatenate 'additional' arrays
        registries: {
            ...sharedConfig.registries,
            ...versionConfig.registries,
            additional: [
                ...new Set([
                    ...(sharedConfig.registries?.additional || []),
                    ...(versionConfig.registries?.additional || []),
                ]),
            ],
        },
        packages: {
            // 'dependencies': version-specific list completely replaces shared list if not empty
            dependencies: versionConfig.packages?.dependencies?.length > 0
                ? versionConfig.packages.dependencies
                : (sharedConfig.packages?.dependencies || []),

            // Merge 'skip' and 'forceSource' objects - version-specific keys override shared keys
            skip: {
                ...(sharedConfig.packages?.skip || {}),
                ...(versionConfig.packages?.skip || {}),
            },
            forceSource: {
                ...(sharedConfig.packages?.forceSource || {}),
                ...(versionConfig.packages?.forceSource || {}),
            },
            
            // 'copyFiles': This is for non-platform-specific files. Concatenate arrays.
            copyFiles: [
                ...(sharedConfig.packages?.copyFiles || []),
                ...(versionConfig.packages?.copyFiles || []),
            ],

            // 'overrides': Merge objects - version-specific keys override shared keys
            overrides: {
                ...(sharedConfig.packages?.overrides || {}),
                ...(versionConfig.packages?.overrides || {}),
            },
            // 'resolution': policy for wheels/source; arrays are de-duped, booleans overridden by version-specific
            resolution: (function () {
                const s = sharedConfig.packages?.resolution || {};
                const v = versionConfig.packages?.resolution || {};
                const lc = (arr) => (arr || []).map(x => (typeof x === 'string' ? x.toLowerCase().replace(/_/g, '-') : x));
                const dedup = (arr) => [...new Set(lc(arr))];
                return {
                    allowSourceAll: (typeof v.allowSourceAll === 'boolean') ? v.allowSourceAll : (s.allowSourceAll || false),
                    strictMissing: (typeof v.strictMissing === 'boolean') ? v.strictMissing : (s.strictMissing || false),
                    allowSourceList: dedup([...(s.allowSourceList || []), ...(v.allowSourceList || [])]),
                    forceNoBinaryList: dedup([...(s.forceNoBinaryList || []), ...(v.forceNoBinaryList || [])]),
                    onlyBinaryList: dedup([...(s.onlyBinaryList || []), ...(v.onlyBinaryList || [])]),
                };
            })(),
            
            // 'platformSpecific': This will be populated next through a deep merge
            platformSpecific: {} 
        }
    };

    // 3. Deep merge 'platformSpecific' separately
    const sharedPlatform = sharedConfig.packages?.platformSpecific || {};
    const versionPlatform = versionConfig.packages?.platformSpecific || {};
    const allPlatformKeys = [...new Set([...Object.keys(sharedPlatform), ...Object.keys(versionPlatform)])];

    if (allPlatformKeys.length > 0) {
        mergedConfig.packages.platformSpecific = {};
        for (const key of allPlatformKeys) {
            const shared = sharedPlatform[key] || {};
            const version = versionPlatform[key] || {};

            // For each platform, merge dependencies and copyFiles arrays
            const platformConfig = {
                dependencies: [...new Set([...(shared.dependencies || []), ...(version.dependencies || [])])],
                copyFiles: [
                    // To handle arrays of objects correctly, stringify for Set and then parse back
                    ...new Set([
                        ...(shared.copyFiles ? shared.copyFiles.map(JSON.stringify) : []),
                        ...(version.copyFiles ? version.copyFiles.map(JSON.stringify) : [])
                    ])
                ].map(JSON.parse),
                resolution: (function () {
                    const s = shared.resolution || {};
                    const v = version.resolution || {};
                    const lc = (arr) => (arr || []).map(x => (typeof x === 'string' ? x.toLowerCase().replace(/_/g, '-') : x));
                    const dedup = (arr) => [...new Set(lc(arr))];
                    const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
                    const r = {};
                    if (Object.keys(s).length > 0 || Object.keys(v).length > 0) {
                        r.allowSourceAll = has(v, 'allowSourceAll') ? v.allowSourceAll : (s.allowSourceAll || false);
                        r.strictMissing = has(v, 'strictMissing') ? v.strictMissing : (s.strictMissing || false);
                        r.allowSourceList = dedup([...(s.allowSourceList || []), ...(v.allowSourceList || [])]);
                        r.forceNoBinaryList = dedup([...(s.forceNoBinaryList || []), ...(v.forceNoBinaryList || [])]);
                        r.onlyBinaryList = dedup([...(s.onlyBinaryList || []), ...(v.onlyBinaryList || [])]);
                    }
                    return r;
                })(),
            };
            
            // Only add the platform to the merged config if it has content
            if (
                platformConfig.dependencies.length > 0 ||
                platformConfig.copyFiles.length > 0 ||
                (platformConfig.resolution && Object.keys(platformConfig.resolution).length > 0)
            ) {
                 mergedConfig.packages.platformSpecific[key] = platformConfig;
            }
        }
    }

    // 4. Apply overrides to the final dependency list
    if (Object.keys(mergedConfig.packages.overrides).length > 0) {
        const overrides = mergedConfig.packages.overrides;
        mergedConfig.packages.dependencies = mergedConfig.packages.dependencies.map(dep => {
            const [name] = dep.split('==');
            if (overrides[name]) {
                return `${name}==${overrides[name]}`;
            }
            return dep;
        });
    }

    console.log("[DEBUG] Final merged config:", JSON.stringify(mergedConfig, null, 2));
    return mergedConfig;
}


/**
 * Validates the final merged configuration.
 * @param {string} version - The Python version being built.
 * @param {Object} config - The merged configuration object.
 */
function validateConfig(version, config) {
  const errors = [];
  
  // A config is valid if it has global dependencies OR at least one platform has dependencies.
  const hasGlobalDeps = config.packages?.dependencies?.length > 0;
  const hasPlatformDeps = Object.values(config.packages?.platformSpecific || {}).some(p => p.dependencies?.length > 0);

  if (!hasGlobalDeps && !hasPlatformDeps) {
    // This could be a valid scenario if only copying files, but for now, we'll suppress the error.
    // errors.push(`No dependencies specified for Python ${version} in global or platform-specific configs.`);
  }
  
  if (errors.length > 0) {
    throw new Error(`Configuration validation failed for ${version}:\n${errors.join('\n')}`);
  }
}

module.exports = {
  mergeConfig,
  validateConfig
};
