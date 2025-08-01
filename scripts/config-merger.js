const fs = require('fs');
const path = require('path');

/**
 * Merges shared configuration with version-specific overrides
 * @param {string} version - Python version (e.g., "3.12.6")
 * @returns {Object} Merged configuration
 */
function mergeConfig(version) {
    const sharedConfigPath = path.join(__dirname, '..', 'shared-config.json');
    const sharedConfig = JSON.parse(fs.readFileSync(sharedConfigPath, 'utf8'));

    const versionConfigPath = path.join(__dirname, '..', `python-${version}/config.json`);
    if (!fs.existsSync(versionConfigPath)) {
        throw new Error(`Version-specific config file not found: ${versionConfigPath}`);
    }
    const versionConfig = JSON.parse(fs.readFileSync(versionConfigPath, 'utf8'));

    // Start building the merged config
    const mergedConfig = {
        ...sharedConfig,
        ...versionConfig,
    };

    // Deep merge registries
    mergedConfig.registries = {
        ...sharedConfig.registries,
        ...versionConfig.registries,
        additional: [
            ...new Set([
                ...(sharedConfig.registries?.additional || []),
                ...(versionConfig.registries?.additional || []),
            ]),
        ],
    };

    // Deep merge packages. Start with an empty object to build upon.
    mergedConfig.packages = {};

    // Explicitly merge each property to avoid overwriting
    mergedConfig.packages.dependencies = versionConfig.packages?.dependencies?.length > 0
        ? versionConfig.packages.dependencies
        : sharedConfig.packages.dependencies;
    
    mergedConfig.packages.skip = {
        ...(sharedConfig.packages?.skip || {}),
        ...(versionConfig.packages?.skip || {}),
    };

    mergedConfig.packages.forceSource = {
        ...(sharedConfig.packages?.forceSource || {}),
        ...(versionConfig.packages?.forceSource || {}),
    };

    mergedConfig.packages.copyFiles = [
        ...(sharedConfig.packages?.copyFiles || []),
        ...(versionConfig.packages?.copyFiles || []),
    ];
    
    mergedConfig.packages.overrides = {
        ...(sharedConfig.packages?.overrides || {}),
        ...(versionConfig.packages?.overrides || {}),
    };
    
    // Deep merge platformSpecific
    const sharedPlatform = sharedConfig.packages?.platformSpecific || {};
    const versionPlatform = versionConfig.packages?.platformSpecific || {};
    const allPlatformKeys = [...new Set([...Object.keys(sharedPlatform), ...Object.keys(versionPlatform)])];
    
    if (allPlatformKeys.length > 0) {
        mergedConfig.packages.platformSpecific = {};
        for (const key of allPlatformKeys) {
            const shared = sharedPlatform[key] || {};
            const version = versionPlatform[key] || {};
            const platformConfig = {
                ...shared,
                ...version,
                dependencies: [...new Set([...(shared.dependencies || []), ...(version.dependencies || [])])],
                copyFiles: [...new Set([...(shared.copyFiles || []), ...(version.copyFiles || [])])],
            };
            // Only add to merged config if there's something to merge
            if (platformConfig.dependencies.length > 0 || platformConfig.copyFiles.length > 0) {
                 mergedConfig.packages.platformSpecific[key] = platformConfig;
            }
        }
    }

    // Handle overrides logic separately as it modifies dependencies
    if (mergedConfig.packages.overrides && Object.keys(mergedConfig.packages.overrides).length > 0) {
        const overrides = mergedConfig.packages.overrides;
        mergedConfig.packages.dependencies = mergedConfig.packages.dependencies.map(dep => {
            const [name] = dep.split('==');
            if (overrides[name]) {
                return `${name}==${overrides[name]}`;
            }
            return dep;
        });
    }

    return mergedConfig;
}

/**
 * Validates configuration for a specific version
 * @param {string} version - Python version
 * @param {Object} config - Configuration object
 */
function validateConfig(version, config) {
  const errors = [];
  
  if (!config.packages?.dependencies || config.packages.dependencies.length === 0) {
    errors.push(`No dependencies specified for Python ${version}`);
  }
  
  if (errors.length > 0) {
    throw new Error(`Configuration validation failed for ${version}:\n${errors.join('\n')}`);
  }
}

module.exports = {
  mergeConfig,
  validateConfig
}; 