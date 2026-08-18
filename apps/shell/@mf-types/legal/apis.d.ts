
    export type RemoteKeys = 'legal/Module';
    type PackageType<T> = T extends 'legal/Module' ? typeof import('legal/Module') :any;