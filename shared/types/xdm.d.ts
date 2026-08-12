/**
 * Placeholder shared TypeScript types for XDM (Experience Data Model)
 * shapes referenced across servers (site-crawler's checks, orchestrator's
 * workflows, web-ui). Not a full XDM type system — just the handful of
 * shapes multiple packages need to agree on today. Extend as needed
 * rather than importing the full Adobe XDM schema definitions wholesale.
 */

export interface XDMIdentityItem {
  id: string;
  namespace: {
    code: string;
  };
  primary?: boolean;
}

export interface XDMIdentityMap {
  [namespaceCode: string]: XDMIdentityItem[];
}

export interface XDMExperienceEvent {
  xdm: {
    eventType: string;
    timestamp: string;
    identityMap?: XDMIdentityMap;
    web?: {
      webPageDetails?: {
        URL?: string;
        name?: string;
      };
    };
    [key: string]: unknown;
  };
}

export interface XDMDatastreamServiceConfig {
  analytics?: {
    reportSuites?: string[];
  };
  target?: {
    propertyToken?: string;
  };
  aep?: {
    datasetId?: string;
  };
  audienceManager?: {
    enabled?: boolean;
  };
}
