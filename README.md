# DDF Tools action

WIP

## Features planned

### Single action
- Validate DDF files
- Bundle DDF files
- Upload bundle to the store

### Continuous integration
- On new PR or commit on the PR
  - Validate all DDF
  - Add a message with modified bundles (if changed from previews commit)
  - Optional bundle the DDF files and add them to the PR as artifacts or "editing bundle" (not sure about this one)

- On commit or PR merge
  - Validate the DDF file
  - Bundle the DDF files
  - Upload the bundle to the store (signed as beta)
  - (For PR) Add a message with the bundle link
  - (For commit) Send a mail / create an issue ? (not sure about this one)

## Other ideas

### Code owners
- Add a CODEOWNERS file to the repository (See [here](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners) for more information)

### Quick edits
- Issue template to add a model ID on a existing DDF that generate PR
