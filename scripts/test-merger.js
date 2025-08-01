const fs = require('fs');
const path = require('path');
const { mergeConfig } = require('./config-merger.js');

/**
 * This script is for diagnostic purposes. It loads the REAL configuration files
 * for a given list of Python versions, runs the merge logic for each, and prints 
 * the final resulting object.
 */
function runDiagnostic(pythonVersion) {
    console.log(`\n--- Running Config Merger for [${pythonVersion}] with REAL files ---`);
    
    try {
        // Suppress the merger's own debug output to avoid clutter
        const originalConsoleLog = console.log;
        const capturedLogs = [];
        console.log = (msg, ...args) => { 
            if (typeof msg === 'string' && msg.startsWith('[DEBUG]')) {
                capturedLogs.push(msg); // Capture for potential display on error
                return;
            };
            originalConsoleLog(msg, ...args);
        };

        // Run the merge function with the real files
        const mergedConfig = mergeConfig(pythonVersion);

        // Restore console.log
        console.log = originalConsoleLog;

        // --- Print the final merged object ---
        console.log(`\n--- Final Merged Config for [${pythonVersion}] ---`);
        console.log(JSON.stringify(mergedConfig, null, 2));
        console.log(`-------------------------------------------\n`);

    } catch (error) {
        console.error(`❌ An error occurred during the merge process for [${pythonVersion}]:`);
        console.error(error);
    }
}

// --- Versions to Test ---
const versionsToTest = ['3.12.10', '3.10.11', '3.12.10-atls'];

console.log("Starting diagnostic run for multiple Python versions...");
versionsToTest.forEach(version => {
    runDiagnostic(version);
});
console.log("Diagnostic run finished.");
