# Dev Presence

A developer presence tracking system consisting of a VS Code extension and an API.

## Projects

| Project | Description |
| --- | --- |
| [dev-presence-extension](./dev-presence-extension) | VS Code extension that tracks coding activity (active/idle/offline) and sends updates to a local agent |
| [dev-presence-api](./dev-presence-api) | Node.js service that accepts presence updates over HTTP and republishes state via HTTP and Socket.IO |

## Quick start

### Extension
```bash
cd dev-presence-extension
npm install
cp agent/.env.example agent/.env
npm run agent
```

### API
```bash
cd dev-presence-api
npm install
cp .env.example .env
npm run dev
```

See the README in each project for detailed setup and usage.

## License

MIT
