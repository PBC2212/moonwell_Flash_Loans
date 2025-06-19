const fs = require('fs');
const path = require('path');

console.log('🚀 Setting up Enterprise Dashboard...');

// Create directories
const directories = ['dashboard', 'dashboard/public', 'logs', 'deployments', 'monitoring'];

directories.forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`✅ Created directory: ${dir}`);
    } else {
        console.log(`📁 Directory already exists: ${dir}`);
    }
});

// Create log files
const logFiles = ['logs/monitoring.log', 'logs/dashboard.log', 'logs/error.log'];

logFiles.forEach(file => {
    if (!fs.existsSync(file)) {
        fs.writeFileSync(file, '');
        console.log(`✅ Created log file: ${file}`);
    }
});

console.log('\n🎉 Dashboard setup complete!');
console.log('📝 Now create the dashboard/server.js file with the provided code');