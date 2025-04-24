# Obsidian Nostr Articles

> Publish and manage nostr articles from Obsidian

A rewrite of [nostr-writer](https://github.com/jamesmagoo/nostr-writer) plugin focused on nostr articles and using [applesauce](https://github.com/hzrd149/applesauce) and [blossom](https://github.com/hzrd149/blossom-client-sdk).

## Install / Update

### In Obsidian

WIP

### Manually Installing the Plugin

- Head over to [releases](https://github.com/hzrd149/obsidian-nostr-publisher/releases) and download a release - latest is recommended - (or the pre-release for upcoming features.)
- Navigate to your plugin folder in your preferred vault: `VaultFolder/.obsidian/plugins/`
- Create a new folder called `nostr-publisher`
- Copy and paste over `main.js`, `styles.css`, `manifest.json` into the newly created `/nostr-publisher` folder.
- Make sure you enable the plugin by going into Settings > Community plugins > Installed plugins > toggle 'Nostr Publisher'.

## TODOs

- [x] publish new articles
- [x] upload images to blossom
  - [x] Upload blobs to servers
  - [x] replace embeds with blob urls
- [x] update existing article
- [x] Download article command
- [x] Download all users articles command
- [x] Add local relays in settings
- [x] Support local relay
- [x] Support NIP-46 bunker signer
- [ ] Handle including "p", "q" tags for `nostr:` mentions
- [ ] Add a "View article" command that opens the article in a nostr client using NIP-89
- [ ] Fix bug with article publishing with old frontmatter
- [ ] Insert nostr user mentions
- [ ] Insert nostr event link
- [ ] Insert nostr article link
- [ ] Convert obsidian links to naddr1 links when publishing
- [ ] Use https://graph.iris.to/ for local user search
- [ ] Add vertex search dvm pubkey in settings ( Fallback to local relay search)
- [ ] Add option to configure zap splits
- [ ] Add option to include a developer zap split in the article
- [ ] Add option to set and upload banner image
