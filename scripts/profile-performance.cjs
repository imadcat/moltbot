#!/usr/bin/env node
/**
 * Performance profiling script for Moltbot
 * Measures startup time, initialization, and key operations
 */

const { performance } = require("node:perf_hooks");
const { readFileSync, statSync, readdirSync } = require("node:fs");
const { join } = require("node:path");

const results = [];

function measure(name, fn) {
  const startTime = performance.now();
  const startMem = process.memoryUsage();

  fn();

  const endTime = performance.now();
  const endMem = process.memoryUsage();
  results.push({
    name,
    duration: endTime - startTime,
    memory: {
      heapUsed: endMem.heapUsed - startMem.heapUsed,
      heapTotal: endMem.heapTotal - startMem.heapTotal,
      external: endMem.external - startMem.external,
    },
  });
}

function analyzeFileIO() {
  console.log("\n=== File I/O Analysis ===\n");

  const srcDir = join(process.cwd(), "src");
  let totalFiles = 0;
  let totalSize = 0;

  function walkDir(dir) {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else if (entry.isFile() && entry.name.endsWith(".ts")) {
          totalFiles++;
          const stat = statSync(fullPath);
          totalSize += stat.size;
        }
      }
    } catch (err) {
      // Skip directories we can't read
    }
  }

  measure("File tree walk", () => {
    walkDir(srcDir);
  });

  console.log(`Total TypeScript files: ${totalFiles}`);
  console.log(`Total size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
  
  return { totalFiles, totalSize };
}

function analyzeModuleImports() {
  console.log("\n=== Module Import Analysis ===\n");

  const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8"));
  const deps = Object.keys(packageJson.dependencies || {});
  const devDeps = Object.keys(packageJson.devDependencies || {});

  console.log(`Production dependencies: ${deps.length}`);
  console.log(`Development dependencies: ${devDeps.length}`);
  
  return { depsCount: deps.length, devDepsCount: devDeps.length };
}

function analyzeCodeComplexity() {
  console.log("\n=== Code Complexity Analysis ===\n");

  const srcDir = join(process.cwd(), "src");
  let totalLines = 0;
  let totalFunctions = 0;
  let totalClasses = 0;
  let totalAsyncOps = 0;
  let totalFileIO = 0;

  function analyzeFile(filePath) {
    try {
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      totalLines += lines.length;

      // Simple regex-based analysis
      totalFunctions += (content.match(/function\s+\w+/g) || []).length;
      totalFunctions += (content.match(/const\s+\w+\s*=\s*\(/g) || []).length;
      totalFunctions += (content.match(/=>\s*{/g) || []).length;
      totalClasses += (content.match(/class\s+\w+/g) || []).length;
      totalAsyncOps += (content.match(/await\s+/g) || []).length;
      totalAsyncOps += (content.match(/\.then\(/g) || []).length;
      totalFileIO += (content.match(/fs\.|readFile|writeFile|createReadStream|createWriteStream/g) || []).length;
    } catch (err) {
      // Skip files we can't read
    }
  }

  function walkDir(dir) {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
          analyzeFile(fullPath);
        }
      }
    } catch (err) {
      // Skip directories we can't read
    }
  }

  measure("Code analysis", () => {
    walkDir(srcDir);
  });

  console.log(`Total lines of code: ${totalLines.toLocaleString()}`);
  console.log(`Total functions: ${totalFunctions.toLocaleString()}`);
  console.log(`Total classes: ${totalClasses}`);
  console.log(`Total async operations: ${totalAsyncOps.toLocaleString()}`);
  console.log(`Total file I/O operations: ${totalFileIO.toLocaleString()}`);
  console.log(`Async density: ${((totalAsyncOps / totalLines) * 100).toFixed(2)}%`);
  
  return { totalLines, totalFunctions, totalClasses, totalAsyncOps, totalFileIO };
}

function identifyBottlenecks(stats) {
  console.log("\n=== Potential Bottlenecks ===\n");

  const bottlenecks = [
    {
      area: "File I/O Operations",
      count: stats.totalFileIO,
      impact: "HIGH",
      description: `${stats.totalFileIO.toLocaleString()} file I/O operations found across codebase`,
      recommendation: "Use file caching, batch operations, or async I/O where possible",
    },
    {
      area: "Module Dependencies",
      count: stats.depsCount,
      impact: "MEDIUM",
      description: `${stats.depsCount} production dependencies requiring loading`,
      recommendation: "Lazy-load non-critical modules, use dynamic imports",
    },
    {
      area: "Media Processing (Sharp)",
      count: 1,
      impact: "HIGH",
      description: "Image processing is CPU-intensive (native addon already in use)",
      recommendation: "Already optimized with native Sharp library",
    },
    {
      area: "Browser Automation (Playwright)",
      count: 1,
      impact: "HIGH",
      description: "Browser automation has high overhead",
      recommendation: "Connection pooling, headless mode optimization",
    },
    {
      area: "Async Operations",
      count: stats.totalAsyncOps,
      impact: "HIGH",
      description: `${stats.totalAsyncOps.toLocaleString()} async operations (${((stats.totalAsyncOps / stats.totalLines) * 100).toFixed(1)}% density)`,
      recommendation: "Optimize promise chains, use Promise.all for parallel ops",
    },
    {
      area: "TypeScript Compilation",
      count: stats.totalFiles,
      impact: "MEDIUM",
      description: `${stats.totalFiles} TypeScript files need compilation`,
      recommendation: "Pre-compile and distribute built JS, use SWC for faster builds",
    },
  ];

  for (const bottleneck of bottlenecks) {
    console.log(`\n${bottleneck.area} [${bottleneck.impact}]`);
    console.log(`  ${bottleneck.description}`);
    console.log(`  → ${bottleneck.recommendation}`);
  }
  
  return bottlenecks;
}

function printResults() {
  console.log("\n=== Performance Measurements ===\n");

  results.sort((a, b) => b.duration - a.duration);

  for (const result of results) {
    console.log(`${result.name}:`);
    console.log(`  Time: ${result.duration.toFixed(2)}ms`);
    if (result.memory) {
      console.log(`  Heap: ${(result.memory.heapUsed / 1024 / 1024).toFixed(2)} MB`);
    }
  }
}

function main() {
  console.log("=".repeat(60));
  console.log("Moltbot Performance Profile");
  console.log("=".repeat(60));

  const startTime = performance.now();
  const startMem = process.memoryUsage();

  const fileStats = analyzeFileIO();
  const moduleStats = analyzeModuleImports();
  const codeStats = analyzeCodeComplexity();
  
  const stats = {
    ...fileStats,
    ...moduleStats,
    ...codeStats,
  };
  
  const bottlenecks = identifyBottlenecks(stats);
  printResults();

  const endTime = performance.now();
  const endMem = process.memoryUsage();

  console.log("\n=== Summary ===\n");
  console.log(`Total profiling time: ${(endTime - startTime).toFixed(2)}ms`);
  console.log(`Memory used: ${((endMem.heapUsed - startMem.heapUsed) / 1024 / 1024).toFixed(2)} MB`);
  
  console.log("\n=== Key Findings ===\n");
  console.log(`1. Codebase size: ${stats.totalLines.toLocaleString()} lines across ${stats.totalFiles} files`);
  console.log(`2. Heavy dependency on external modules (${stats.depsCount} packages)`);
  console.log(`3. High async operation density (${((stats.totalAsyncOps / stats.totalLines) * 100).toFixed(1)}%)`);
  console.log(`4. ${stats.totalFileIO.toLocaleString()} file I/O operations`);
  console.log(`5. Already using native addons (Sharp, Playwright)`);
  
  console.log("\n=== Realistic Optimization Recommendations ===\n");
  console.log("⚠️  NOTE: Complete Rust rewrite would take 6-12 months");
  console.log("⚠️  More practical approaches for 10X improvement:\n");
  console.log("✓ TARGET: Critical hot paths only (not full rewrite)");
  console.log("✓ PROFILE: Real-world usage with Node.js profiler");
  console.log("✓ OPTIMIZE: Top 3-5 bottlenecks identified from profiling");
  console.log("✓ RUST NAPI: Consider for CPU-bound parsing/processing only");
  console.log("✓ CACHING: Aggressive caching for frequently accessed data");
  console.log("✓ LAZY LOADING: Defer module loading until needed");
  console.log("✓ WORKER THREADS: Offload CPU work from main thread");
  console.log("✓ DB OPTIMIZATION: Add indexes, optimize queries");
  console.log("✓ CONNECTION POOLING: Reuse connections to external services");
  console.log("\n=== Actual Bottleneck Candidates ===\n");
  
  const topBottlenecks = bottlenecks
    .filter(b => b.impact === "HIGH")
    .sort((a, b) => b.count - a.count);
    
  topBottlenecks.forEach((b, i) => {
    console.log(`${i + 1}. ${b.area} (${b.count.toLocaleString()} instances)`);
  });
  
  console.log("\n💡 Next Steps:");
  console.log("1. Run with Node.js --prof flag on real workloads");
  console.log("2. Analyze flamegraphs to find actual hot paths");
  console.log("3. Optimize top 3 bottlenecks before considering rewrites");
}

main();
