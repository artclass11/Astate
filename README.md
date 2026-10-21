# Astate — Property Match

**Live website:** https://headless-jcrzxssmnuf-myastate-1408.wix-site-host.com/

Astate is a text-first real-estate marketplace and buyer/seller matcher. People can post without creating an account. The website accepts property-related listings such as agricultural land, plots, houses, flats, villas, farmhouses, buildings, hotels, resorts, cafes/restaurants premises, offices, shops, warehouses and other real-estate assets.

## Current architecture

- **Hosting and CMS:** Wix Headless; public records are stored in `propertyListings`. Raw post copies, when saved, are stored in the restricted `propertyIntakes` collection.
- **Posting:** the website checks for real-estate subject matter, redacts common phone/email/URL patterns from public descriptions, and publishes the public property facts automatically.
- **Matching:** heuristic fit scores use the available location, category/use, stated budget/asking price, area and site-feature information. Match results include reasons/caveats; they are not title or ownership verification.
- **Exports:** use the JSON/CSV buttons on the live directory to save the public feed locally.
- **Contacts:** Instagram [@amormagics](https://www.instagram.com/amormagics/) and [@arcstudio91](https://www.instagram.com/arcstudio91/).
- **SEO/AI:** the live site includes a sitemap, robots.txt, llms.txt, structured page metadata, and an AI-readable public data view.

The static website runs on Wix because it is already connected to Wix CMS. The workflow in `.github/workflows/mirror-live-site.yml` keeps public frontend source files in this repository for version history. The repository itself is not the database.

## Run the local MCP integration

The read-only MCP server exposes public Astate listings to AI tools that support a local stdio MCP process. It does not expose private intake records and does not create or modify listings.

```bash
npm install
npm start
```

To connect an MCP-capable desktop client, copy `mcp-config.example.json` into that client's MCP configuration and replace the example file path with the absolute path to `mcp-server.mjs`. Restart the client after saving the configuration.

**Remote MCP limitation:** a GitHub repository alone cannot host a persistent MCP HTTP endpoint. This repo includes a local stdio connector; a public hosted connector still needs a host that runs the server and must be registered with the relevant AI client.

## Public posting and security notes

The site's browser validates property relevance and rejects obvious unrelated product posts. Because this current site is a static client connected directly to Wix Data, a technically capable caller may bypass browser-side checks by calling the public data API directly. Do not treat client-side validation as a security boundary or anti-spam system. A proper remote posting gateway with server-side validation/rate limiting is a separate deployment step.

Public posts can be copied or indexed by search engines and other visitors. Basic pattern redaction may miss unusual contact formats. Contributors should avoid typing personal or sensitive information into a public post.

## Search visibility

The site provides crawler-friendly metadata, structured page markup, sitemap.xml, robots.txt, and llms.txt. Search ranking or indexing is controlled by search engines and cannot be guaranteed; verified domain ownership, Search Console submission, useful original listing content, external references, and sustained activity still matter.
