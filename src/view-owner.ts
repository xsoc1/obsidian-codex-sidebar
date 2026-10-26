import type CodexSidebarPlugin from "./main";

// Type-only host contract: importing the view never initializes desktop modules.
export interface SidebarOwner extends Pick<CodexSidebarPlugin, keyof CodexSidebarPlugin> { }
