# B3nd Claude Code Plugin

Development tools for building applications with the B3nd universal persistence
protocol.

## Quick Install

```bash
# Add the B3nd marketplace from GitHub
claude plugin marketplace add https://github.com/bandeira-tech/b3nd

# Install the plugin
claude plugin install b3nd --scope user
```

Or interactively from within Claude Code:

```
> /plugin marketplace add https://github.com/bandeira-tech/b3nd
> /plugin install b3nd
```

## What's Included

### Skills (Auto-activated by Claude)

| Skill            | Description                                     |
| ---------------- | ----------------------------------------------- |
| **b3nd-general** | Core B3nd architecture, URI schemes, interfaces |
| **b3nd-sdk**     | Deno/JSR package `@bandeira-tech/b3nd-sdk`      |
| **b3nd-web**     | NPM package `@bandeira-tech/b3nd-web`           |
| **b3nd-webapp**  | React/Vite web app patterns                     |
| **b3nd-denocli** | Deno CLI and server patterns                    |

## Usage Examples

Once installed, just ask Claude naturally:

```
> How do I create a B3nd HTTP client?
> How do I use the Rig with a PostgreSQL backend?
> Show me how to observe changes on a URI pattern
```

## Requirements

- Claude Code CLI

## Links

- [B3nd SDK Documentation](https://github.com/bandeira-tech/b3nd)
- [NPM Package](https://www.npmjs.com/package/@bandeira-tech/b3nd-web)
- [JSR Package](https://jsr.io/@bandeira-tech/b3nd-sdk)
