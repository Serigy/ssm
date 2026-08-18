
    export type RemoteKeys = 'hr/Module';
    type PackageType<T> = T extends 'hr/Module' ? typeof import('hr/Module') :any;