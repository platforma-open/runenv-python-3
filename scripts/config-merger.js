const fs = require('fs');
const path = require('path');

/**
 * Merges shared configuration with version-specific overrides
 * @param {string} version - Python version (e.g., "3.12.6")
 * @returns {Object} Merged configuration
 */
function mergeConfig(version) {
  // Load shared configuration
  const sharedConfigPath = path.join(__dirname, '..', 'shared-config.json');
  const sharedConfig = JSON.parse(fs.readFileSync(sharedConfigPath, 'utf8'));
  
  // Load version-specific configuration
  const versionConfigPath = path.join(__dirname, '..', `python-${version}/config.json`);
  
  if (!fs.existsSync(versionConfigPath)) {
      throw new Error(`Version-specific config file not found. Please check the version string and path: ${versionConfigPath}`);
  }
  
  const versionConfig = JSON.parse(fs.readFileSync(versionConfigPath, 'utf8'));
  
  // Merge configurations
  const mergedConfig = {
    // Top-level keys from versionConfig will overwrite sharedConfig
    ...sharedConfig,
    ...versionConfig,
  };

  // Deep merge 'registries'
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

  // Deep merge 'packages'
  mergedConfig.packages = {
    // Keep all keys from both
    ...sharedConfig.packages,
    ...versionConfig.packages,

    // But specifically handle arrays and nested objects
    dependencies:
      versionConfig.packages?.dependencies?.length > 0
        ? versionConfig.packages.dependencies
        : sharedConfig.packages.dependencies,
    skip: {
      ...sharedConfig.packages?.skip,
      ...versionConfig.packages?.skip,
    },
    forceSource: {
      ...sharedConfig.packages?.forceSource,
      ...versionConfig.packages?.forceSource,
    },
    copyFiles: [
      ...(sharedConfig.packages?.copyFiles || []),
      ...(versionConfig.packages?.copyFiles || []),
    ],
  };
  
  // Special handling for platformSpecific to deep merge arrays
  if (sharedConfig.packages?.platformSpecific || versionConfig.packages?.platformSpecific) {
    const allPlatformKeys = [
      ...Object.keys(sharedConfig.packages?.platformSpecific || {}),
      ...Object.keys(versionConfig.packages?.platformSpecific || {})
    ];
    const uniquePlatformKeys = [...new Set(allPlatformKeys)];

    mergedConfig.packages.platformSpecific = {};
    for (const key of uniquePlatformKeys) {
      const shared = sharedConfig.packages?.platformSpecific?.[key] || {};
      const version = versionConfig.packages?.platformSpecific?.[key] || {};
      const mergedPlatform = {
        ...shared,
        ...version,
        dependencies: [
          ...new Set([
            ...(shared.dependencies || []),
            ...(version.dependencies || [])
          ])
        ],
        copyFiles: [
          ...new Set([
            ...(shared.copyFiles || []),
            ...(version.copyFiles || [])
          ])
        ]
      };

      // Clean up empty arrays
      if (mergedPlatform.dependencies.length === 0) {
        delete mergedPlatform.dependencies;
      }
      if (mergedPlatform.copyFiles.length === 0) {
        delete mergedPlatform.copyFiles;
      }
      
      if (Object.keys(mergedPlatform).length > 0) {
        mergedConfig.packages.platformSpecific[key] = mergedPlatform;
      }
    }
  }
  
  // Apply package overrides if specified
  if (versionConfig.packages?.overrides) {
    const overrides = versionConfig.packages.overrides;
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