export class EditorController {
  constructor({ projectService, workspaceProvider, workspaceConsumer }) {
    this.projectService = projectService;
    this.workspaceProvider = workspaceProvider;
    this.workspaceConsumer = workspaceConsumer;
    this.definitionId = null;
    this.revisionId = null;
  }

  async load(definitionId) {
    const result = await this.projectService.load(definitionId);
    this.definitionId = result.definition.id;
    this.revisionId = result.revision.id;
    this.workspaceConsumer(result.workspace);
    return result;
  }

  async save(options = {}) {
    const result = await this.projectService.save({
      ...options,
      definitionId: this.definitionId,
      basedOnRevisionId: this.revisionId,
      workspace: this.workspaceProvider(),
    });
    this.definitionId = result.definition?.id ?? this.definitionId;
    this.revisionId = result.revision.id;
    return result;
  }
}
