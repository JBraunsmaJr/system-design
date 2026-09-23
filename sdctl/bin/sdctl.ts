#!/usr/bin/env node
import process from 'node:process';
import { runCli } from '../src/cli.js';

runCli(process.argv.slice(2))
  .then((exitCode) => {
    process.exit(exitCode);
  })
  .catch((err) => {
    console.error(`Fatal error: ${err.message || err}`);
    process.exit(1);
  });
