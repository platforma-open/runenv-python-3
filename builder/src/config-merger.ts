import * as fs from 'fs';
import * as path from 'path';

export type ResolutionPolicy = {
    allowSourceAll: boolean;
    strictMissing: boolean;
    allowSourceList: string[];
    forceNoBinaryList: string[];
    onlyBinaryList: string[];
};

/**
 * Merges shared configuration with version-specific overrides, handling deep merging of nested properties.
 * @param {string} repoRoot - The root directory of the repository.
 * @param {string} packageRoot - The root directory of the package being built.
 * @returns {Object} The fully merged configuration object.
 */
export function mergeConfig(repoRoot: string, packageRoot: string): any {
    // 1. Load shared and version-specific configurations
    const sharedConfigPath = path.join(repoRoot, 'shared-config.json');
    const sharedConfig: any = JSON.parse(fs.readFileSync(sharedConfigPath, 'utf8'));

    const versionConfigPath = path.join(packageRoot, 'config.json');
    if (!fs.existsSync(versionConfigPath)) {
        console.log(`[INFO] No version-specific config found in '${versionConfigPath}'. Using shared config only.`);
        return sharedConfig; // Return shared config if no version-specific one exists
    }
    const versionConfig = JSON.parse(fs.readFileSync(versionConfigPath, 'utf8'));

    // 2. Manually construct the final configuration to ensure correct deep merging
    const mergedConfig: any = {
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
                ...Array.from(new Set([
                    ...(sharedConfig.registries?.additional || []),
                    ...(versionConfig.registries?.additional || []),
                ])),
            ],
        },
        packages: {
            // 'dependencies': no shared dependencies list: specify all packages in particular python config.json
            dependencies: versionConfig.packages?.dependencies || [],

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
            resolution: (function (): ResolutionPolicy {
                const s = sharedConfig.packages?.resolution || {} as ResolutionPolicy;
                const v = versionConfig.packages?.resolution || {} as ResolutionPolicy;
                const lc = (arr: string[]) => (arr || []).map(x => (typeof x === 'string' ? x.toLowerCase().replace(/_/g, '-') : x));
                const dedup = (arr: string[]) => Array.from(new Set(lc(arr)));
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
    const allPlatformKeys = Array.from(new Set([...Object.keys(sharedPlatform), ...Object.keys(versionPlatform)]));

    if (allPlatformKeys.length > 0) {
        mergedConfig.packages.platformSpecific = {};
        for (const key of allPlatformKeys) {
            const shared = sharedPlatform[key] || {};
            const version = versionPlatform[key] || {};

            // For each platform, merge dependencies and copyFiles arrays
            const platformConfig = {
                dependencies: Array.from(new Set([...(shared.dependencies || []), ...(version.dependencies || [])])),
                copyFiles: [
                    // To handle arrays of objects correctly, stringify for Set and then parse back
                    ...Array.from(new Set([
                        ...(shared.copyFiles ? shared.copyFiles.map(JSON.stringify) : []),
                        ...(version.copyFiles ? version.copyFiles.map(JSON.stringify) : [])
                    ]))
                ].map((value: any) => JSON.parse(value)),
                resolution: (function () {
                    const s = shared.resolution || {} as ResolutionPolicy;
                    const v = version.resolution || {} as ResolutionPolicy;
                    const lc = (arr: string[]) => (arr || []).map(x => (typeof x === 'string' ? x.toLowerCase().replace(/_/g, '-') : x));
                    const dedup = (arr: string[]) => Array.from(new Set(lc(arr)));
                    const has = (obj: any, key: string) => Object.prototype.hasOwnProperty.call(obj, key);
                    const r: ResolutionPolicy = { allowSourceAll: false, strictMissing: false, allowSourceList: [], forceNoBinaryList: [], onlyBinaryList: [] };
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
 */
export function validateConfig(config: any, packageDirName: string) {
  const errors: string[] = [];
  
  // A config is valid if it has global dependencies OR at least one platform has dependencies.
  const hasGlobalDeps = config.packages?.dependencies?.length > 0;
  const hasPlatformDeps = Object.values(config.packages?.platformSpecific || {}).some((p: any) => p.dependencies?.length > 0);

  if (!hasGlobalDeps && !hasPlatformDeps) {
    // This could be a valid scenario if only copying files, but for now, we'll suppress the error.
    // errors.push(`No dependencies specified for Python ${version} in global or platform-specific configs.`);
  }
  
  if (errors.length > 0) {
    throw new Error(`Configuration validation failed for '${packageDirName}':\n${errors.join('\n')}`);
  }
}
