# Linux portable bundle

Extract the complete TURNLOOM folder into a writable location. Run:

```sh
./TURNLOOM.sh
```

The bundle includes Node 22.23.4 for Linux x64 GNU libc. It requires normal Linux
system libraries and a browser; it does not require a system Node installation.
Open the local URL in the `TURNLOOM_READY` output. Stop the server with Ctrl+C.

The existing server options pass through unchanged:

```sh
./TURNLOOM.sh --port 0 --data-dir /absolute/path/to/your-private-data
```

The launcher inherits the existing `PORT` and `TURNLOOM_DATA_DIR` environment
settings; explicit CLI options override server defaults. With no data override,
saved rooms live in `app/.turnloom` inside the extracted folder.
Keep that directory when upgrading or choose a stable private data directory.
Do not distribute a used folder containing private rooms. Participant capabilities
do not protect private data from the host operator. This is a local application,
not a hosted multi-device service or evidence of participant effectiveness.

## Offline build and receiving

From a clean committed checkout, using an already available official
`node-v22.23.4-linux-x64.tar.gz`:

```sh
npm run package:linux -- /absolute/path/to/node-v22.23.4-linux-x64.tar.gz /new/output/path
```

The builder verifies pinned archive and executable hashes, invokes the maintained
runtime packager with the verified Node and the existing npm CLI, and excludes
user rooms. The destination must not exist. BUILD.json identifies source commit,
tree and runtime; SHA256SUMS covers all payload files except itself. The adjacent
checksum identifies the complete archive.

Native build, actual bundled launcher, save/restart and extracted browser receiving
must be recorded against the exact delivered archive before claiming qualification.
Consult the release receiving assets for the exact source, archive checksum,
platform, observed checks and remaining limits; building alone does not qualify use.
