# b3nd Development Environments

This directory contains pre-configured development and deployment environments for b3nd.

## Available Installations

### Full Stack (`installations/full-stack/`)

Complete deployment with all b3nd components:
- **wsserver**: WebSocket persistence backend (Port 8001)
- **httpapi**: REST API server (Port 8000)
- **explorer**: Web UI application (Port 3000)

**Quick Start:**
```bash
cd installations/full-stack
./start.sh
```

**Using Make:**
```bash
cd installations/full-stack
make help      # Show all available commands
make up        # Start all services
make logs      # View logs
make health    # Check service health
make down      # Stop all services
```

**Manual:**
```bash
cd installations/full-stack
podman-compose up -d    # or docker-compose up -d
```

See `installations/full-stack/README.md` for detailed documentation.

## Requirements

- **Container Engine**: Podman or Docker
- **Compose Tool**: podman-compose or docker-compose

### Installing Dependencies

**macOS (using Homebrew):**
```bash
brew install podman podman-compose
```

**Linux:**
```bash
# Ubuntu/Debian
sudo apt-get install podman podman-compose

# Fedora/RHEL
sudo dnf install podman podman-compose
```

**Using Docker instead:**
```bash
# Install Docker Desktop or Docker Engine
# Then install docker-compose
```

## Configuration

All installations support configuration via:
1. Environment variables (`.env` file)
2. Command-line arguments
3. Default values

Each installation includes:
- `compose.yaml` - Service definitions
- `.env.example` - Configuration template
- `Dockerfile.*` - Container images
- `README.md` - Detailed documentation
- `Makefile` - Common commands
- `start.sh` - Quick start script

## Creating New Installations

To create a new installation:

1. Create directory: `installations/my-installation/`
2. Add `compose.yaml` with service definitions
3. Add `Dockerfile.*` for each service
4. Add `.env.example` for configuration
5. Add `README.md` with documentation
6. Optionally add `Makefile` and `start.sh`

## Development vs Production

The provided installations are optimized for development and testing. For production:

1. **Security**: Add authentication, SSL/TLS, secrets management
2. **Monitoring**: Add Prometheus, Grafana, or similar
3. **Logging**: Configure centralized logging
4. **Backups**: Implement backup strategy for volumes
5. **Resources**: Set CPU/memory limits
6. **Networking**: Use reverse proxy (nginx, traefik)
7. **High Availability**: Consider multi-instance deployments

## Troubleshooting

### Port Conflicts

If ports are already in use:
```bash
# Check what's using a port
lsof -i :8000
lsof -i :8001
lsof -i :3000

# Or customize ports in .env
echo "HTTP_PORT=9000" >> .env
```

### Container Engine Issues

```bash
# Check if service is running
podman info
systemctl status podman.socket  # Linux

# Reset podman
podman system reset  # WARNING: removes all containers and images
```

### Service Health

```bash
# Check service status
podman-compose ps

# View logs
podman-compose logs -f

# Check individual service
podman-compose logs wsserver
```

## Contributing

When adding new installations:
1. Follow existing structure and naming conventions
2. Include comprehensive README
3. Add `.env.example` with all options documented
4. Test on both podman and docker
5. Include health checks for all services
6. Document resource requirements

## License

See repository root LICENSE file.