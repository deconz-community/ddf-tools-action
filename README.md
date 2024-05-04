# DDF Tools action

## Features

### Single action
- Validate DDF files
- Bundle DDF files
- Upload bundles as github artifact
- Upload bundles to the store

### Continuous integration
- On new PR or commit on the PR
  - Validate all DDF
  - Add a message with modified bundles
  - Upload the bundles as artifacts

- On commit or PR merge
  - Validate the DDF file
  - Bundle the DDF files
  - Upload the bundle to the store
  - (For PR) Add a message with the bundle store link

## Maybe next Features

### Code owners
- Add a CODEOWNERS file to the repository (See [here](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners) for more information)

### Quick edits
- Issue template to add a model ID on a existing DDF that generate PR
