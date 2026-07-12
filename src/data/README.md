# MH Wilds Planner Data

This directory contains the core data files used by the application to power the search, reverse-lookups, and UI displays. The data is split into automatically generated files (fetched from the community API) and manually curated files.

## Automated Datasets

These files are automatically generated during the build process by running `node scripts/fetch-data.js`. **Do not edit these manually**, as they will be overwritten the next time the data pipeline runs!

- **`armor-sets.json`**: Contains full armor sets, their individual pieces, crafting material costs, and stats/skills. Fetched from the API.
- **`charms.json`**: Contains the equippable charms, their granted skills, and crafting materials. Fetched from the API.
- **`material-index.json`**: A reverse-lookup dictionary built during the pipeline. It maps material names (e.g., "Gore Magala Scale+") directly to the monsters that drop them and their exact drop conditions (carve, break, %, etc).

## Curated Datasets

These files are maintained manually because the community API currently lacks this information. 

- **`gathering-sources.json`**: Hand-curated drop locations for non-large-monster items. Maps materials like "Firestone" and "Wingdrake Hide+" directly to their gathering nodes, small monsters, and locales.
- **`pendants.json`**: Contains cosmetic weapon/seikret pendants (e.g., "Hope Scarf: Crimson"). Pendants do not grant skills and are not tracked by the main API.
- **`quests.json`**: A manually curated list of quests (mostly Event and Repeatable Optionals) matched with their target monsters and exclusive reward items (like Event Tickets). The app uses this file in combination with the `material-index.json` to tell you which quest is best to farm a specific material.

---
*Note: To update the automated datasets, simply run `node scripts/fetch-data.js` from the project root in your terminal.*
