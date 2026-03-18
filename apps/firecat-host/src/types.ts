/** Configuration for the firecat-host server */
export interface HostConfig {
  backendUrl: string;
  port: number;
  target?: string;
  primaryDomain?: string;
}

/** Domain mapping stored in B3nd at mutable://open/domains/{domain} */
export interface DomainMapping {
  target: string;
  owner?: string;
  created?: number;
}
