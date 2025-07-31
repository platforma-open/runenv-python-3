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
  let versionConfig = {};
  
  if (fs.existsSync(versionConfigPath)) {
    versionConfig = JSON.parse(fs.readFileSync(versionConfigPath, 'utf8'));
  }
  
  // Merge configurations
  const mergedConfig = {
    ...sharedConfig,
    packages: {
      ...sharedConfig.packages,
      ...versionConfig.packages,
      dependencies: versionConfig.packages?.dependencies?.length > 0 
        ? versionConfig.packages.dependencies 
        : sharedConfig.packages.dependencies,
      skip: {
        ...sharedConfig.packages.skip,
        ...versionConfig.packages?.skip
      },
      forceSource: {
        ...sharedConfig.packages.forceSource,
        ...versionConfig.packages?.forceSource
      },
      copyFiles: [
        ...(sharedConfig.packages.copyFiles || []),
        ...(versionConfig.packages?.copyFiles || [])
      ]
    }
  };
  
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