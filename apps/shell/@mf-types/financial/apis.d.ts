
    export type RemoteKeys = 'financial/Module';
    type PackageType<T> = T extends 'financial/Module' ? typeof import('financial/Module') :any;