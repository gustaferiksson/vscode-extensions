# Multi-Repo Workspace Explorer

A VS Code extension that helps you manage multiple Git repositories in your workspace with an intuitive repository browser and individual workspace folder views.

## Features

### Repository Browser
- **Discover Repositories**: Automatically scans configured paths for Git repositories
- **Organize by Folder**: Groups repositories by parent folder 
- **Quick Actions**: Add to workspace, remove from workspace, or open in new window with a single click
- **Status Indicators**: See which repositories are currently active in your workspace

### Workspace Folder Views
- **Separate Views**: Each workspace folder gets its own collapsible tree view in the Explorer
- **Stable Display**: Adding or removing folders doesn't disrupt other views
- **Folder-First Sorting**: Folders appear before files, just like the standard Explorer
- **Git-Aware Names**: Views show repository names extracted from Git remotes

## Setup

1. Install the extension
2. Open Settings (`Cmd+,` or `Ctrl+,`)
3. Search for `Multi-Repo Workspace Explorer: Repo Paths`
4. Add base paths to scan for repositories (e.g., `~/Repos`, `/Users/username/Projects`)
5. Click the folder-library icon in the Activity Bar to open the Repository Browser

## Usage

### Adding Repositories
1. Open the Repository Browser from the Activity Bar
2. Browse your configured paths
3. Click the `+` icon next to any repository to add it to your workspace

**Note:** Adding your first or second repository will cause VS Code to reload (this is a VS Code platform limitation). Subsequent additions work seamlessly without reloads.

### Removing Repositories
1. Find the repository in the Repository Browser (marked with "✓ In workspace")
2. Click the `-` icon to remove it from your workspace

**Note:** Removing the **first** folder in your workspace will cause VS Code to reload (this is a VS Code platform limitation). To avoid reloads, remove other folders first, then remove the first one last.

### Opening in New Window
- Click the window icon next to any repository to open it in a separate VS Code window

## Configuration

- `gitWorkspaceManager.repoPaths`: Array of base paths to scan for Git repositories

## Requirements

- VS Code 1.85.0 or higher
- Git installed and available in PATH

## Known Issues

### Workspace Reload Behavior
Due to VS Code platform limitations, certain operations will cause the window to reload:

- **Adding the first repository** (empty → single-folder workspace) - unavoidable reload
- **Adding the second repository** (single-folder → multi-root workspace) - unavoidable reload
- **Removing the first folder** in a multi-folder workspace - unavoidable reload

**Workaround for removals:** When cleaning up your workspace, remove folders from bottom to top to minimize reloads. Only the first folder triggers a reload when removed.

Please report other issues on [GitHub](https://github.com/gustaferiksson/workspace-explorer/issues).
