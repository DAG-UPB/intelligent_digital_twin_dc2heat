/** Typed client for the FastAPI backend, one module per backend router; import from here. */
export * from "./components";
export * from "./dataVersions";
export * from "./datasets";
export * from "./documents";
export * from "./foundation";
export * from "./graphs";
export * from "./live";
export * from "./market";
export * from "./models";
export * from "./pid";
export * from "./prepare";
export * from "./project";
export * from "./site";
export * from "./waermeatlas";
export { CLIENT_ID, getBlob, type StructureScope } from "./http";
