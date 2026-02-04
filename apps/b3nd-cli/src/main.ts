#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-net

import {
  accountCreate,
  encryptCreate,
  confNode,
  confAccount,
  confEncrypt,
  write,
  upload,
  deploy,
  read,
  list,
  showConfig,
  showHelp,
  serverKeysEnv,
} from "./commands.ts";

/**
 * Parse verbose flag from args
 */
function parseVerboseFlag(args: string[]): { args: string[]; verbose: boolean } {
  const index = args.findIndex((arg) => arg === "-v" || arg === "--verbose");
  if (index !== -1) {
    return {
      args: args.filter((_, i) => i !== index),
      verbose: true,
    };
  }
  return { args, verbose: false };
}

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  const args = Deno.args;

  if (args.length === 0) {
    showHelp();
    return;
  }

  const { args: cleanArgs, verbose } = parseVerboseFlag(args);
  const command = cleanArgs[0];
  const subcommand = cleanArgs[1];

  try {
    switch (command) {
      case "account": {
        if (!subcommand) {
          throw new Error("Subcommand required. Usage: bnd account <create>");
        }

        if (subcommand === "create") {
          await accountCreate(cleanArgs[2]);
        } else {
          throw new Error(`Unknown account subcommand: ${subcommand}`);
        }
        break;
      }

      case "encrypt": {
        if (!subcommand) {
          throw new Error("Subcommand required. Usage: bnd encrypt <create>");
        }

        if (subcommand === "create") {
          await encryptCreate(cleanArgs[2]);
        } else {
          throw new Error(`Unknown encrypt subcommand: ${subcommand}`);
        }
        break;
      }

      case "conf": {
        if (!subcommand) {
          throw new Error("Subcommand required. Usage: bnd conf <node|account|encrypt> <value>");
        }

        if (subcommand === "node") {
          if (!cleanArgs[2]) {
            throw new Error("Node URL required. Usage: bnd conf node <url>");
          }
          await confNode(cleanArgs[2]);
        } else if (subcommand === "account") {
          if (!cleanArgs[2]) {
            throw new Error("Account key path required. Usage: bnd conf account <path>");
          }
          await confAccount(cleanArgs[2]);
        } else if (subcommand === "encrypt") {
          if (!cleanArgs[2]) {
            throw new Error("Encryption key path required. Usage: bnd conf encrypt <path>");
          }
          await confEncrypt(cleanArgs[2]);
        } else {
          throw new Error(`Unknown conf subcommand: ${subcommand}`);
        }
        break;
      }

      case "write": {
        await write(cleanArgs.slice(1), verbose);
        break;
      }

      case "upload": {
        await upload(cleanArgs.slice(1), verbose);
        break;
      }

      case "deploy": {
        await deploy(cleanArgs.slice(1), verbose);
        break;
      }

      case "read": {
        if (!cleanArgs[1]) {
          throw new Error("URI required. Usage: bnd read <uri>");
        }
        await read(cleanArgs[1], verbose);
        break;
      }

      case "list": {
        if (!cleanArgs[1]) {
          throw new Error("URI required. Usage: bnd list <uri>");
        }
        await list(cleanArgs[1], verbose);
        break;
      }

      case "config": {
        await showConfig();
        break;
      }

      case "server-keys": {
        if (subcommand === "env") {
          await serverKeysEnv();
        } else {
          throw new Error("Unknown server-keys subcommand. Usage: bnd server-keys env");
        }
        break;
      }

      case "help":
      case "-h":
      case "--help": {
        showHelp();
        break;
      }

      default:
        throw new Error(`Unknown command: ${command}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`✗ Error: ${message}`);
    Deno.exit(1);
  }
}

// Run main function
main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`✗ Fatal error: ${message}`);
  Deno.exit(1);
});
