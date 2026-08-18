import type { CreateEmployee, Employee, EmployeeFilter, OffboardEmployee, Page } from '@ssm/contracts';
import type { ApiClient } from '@ssm/mfe-runtime';
export declare const hrApi: {
    readonly list: (api: ApiClient, filter: EmployeeFilter & {
        limit?: number;
        cursor?: string;
    }) => Promise<Page<{
        status: "active" | "applicant" | "onboarding" | "on_leave" | "offboarding" | "terminated";
        createdAt: string;
        createdBy: string | null;
        updatedAt: string;
        updatedBy: string | null;
        id: string;
        tenantId: string;
        departmentId: string | null;
        startDate: string;
        documentKey: string | null;
        personalEmail: string | null;
        phone: string | null;
        nationalId: string | null;
        dateOfBirth: string | null;
        address: {
            line1: string;
            city: string;
            postalCode: string;
            country: string;
            line2?: string | undefined;
        } | null;
        employeeNumber: string;
        userId: string | null;
        firstName: string;
        lastName: string;
        workEmail: string;
        contractType: "permanent" | "fixed_term" | "contractor" | "intern" | "apprentice";
        jobTitle: string;
        managerId: string | null;
        endDate: string | null;
        salary: {
            amountMinor: number;
            currency: string;
        } | null;
    }>>;
    readonly get: (api: ApiClient, id: string) => Promise<{
        status: "active" | "applicant" | "onboarding" | "on_leave" | "offboarding" | "terminated";
        createdAt: string;
        createdBy: string | null;
        updatedAt: string;
        updatedBy: string | null;
        id: string;
        tenantId: string;
        departmentId: string | null;
        startDate: string;
        documentKey: string | null;
        personalEmail: string | null;
        phone: string | null;
        nationalId: string | null;
        dateOfBirth: string | null;
        address: {
            line1: string;
            city: string;
            postalCode: string;
            country: string;
            line2?: string | undefined;
        } | null;
        employeeNumber: string;
        userId: string | null;
        firstName: string;
        lastName: string;
        workEmail: string;
        contractType: "permanent" | "fixed_term" | "contractor" | "intern" | "apprentice";
        jobTitle: string;
        managerId: string | null;
        endDate: string | null;
        salary: {
            amountMinor: number;
            currency: string;
        } | null;
    }>;
    readonly create: (api: ApiClient, dto: CreateEmployee) => Promise<{
        status: "active" | "applicant" | "onboarding" | "on_leave" | "offboarding" | "terminated";
        createdAt: string;
        createdBy: string | null;
        updatedAt: string;
        updatedBy: string | null;
        id: string;
        tenantId: string;
        departmentId: string | null;
        startDate: string;
        documentKey: string | null;
        personalEmail: string | null;
        phone: string | null;
        nationalId: string | null;
        dateOfBirth: string | null;
        address: {
            line1: string;
            city: string;
            postalCode: string;
            country: string;
            line2?: string | undefined;
        } | null;
        employeeNumber: string;
        userId: string | null;
        firstName: string;
        lastName: string;
        workEmail: string;
        contractType: "permanent" | "fixed_term" | "contractor" | "intern" | "apprentice";
        jobTitle: string;
        managerId: string | null;
        endDate: string | null;
        salary: {
            amountMinor: number;
            currency: string;
        } | null;
    }>;
    readonly activate: (api: ApiClient, id: string) => Promise<{
        status: "active" | "applicant" | "onboarding" | "on_leave" | "offboarding" | "terminated";
        createdAt: string;
        createdBy: string | null;
        updatedAt: string;
        updatedBy: string | null;
        id: string;
        tenantId: string;
        departmentId: string | null;
        startDate: string;
        documentKey: string | null;
        personalEmail: string | null;
        phone: string | null;
        nationalId: string | null;
        dateOfBirth: string | null;
        address: {
            line1: string;
            city: string;
            postalCode: string;
            country: string;
            line2?: string | undefined;
        } | null;
        employeeNumber: string;
        userId: string | null;
        firstName: string;
        lastName: string;
        workEmail: string;
        contractType: "permanent" | "fixed_term" | "contractor" | "intern" | "apprentice";
        jobTitle: string;
        managerId: string | null;
        endDate: string | null;
        salary: {
            amountMinor: number;
            currency: string;
        } | null;
    }>;
    readonly offboard: (api: ApiClient, id: string, dto: OffboardEmployee) => Promise<{
        status: "active" | "applicant" | "onboarding" | "on_leave" | "offboarding" | "terminated";
        createdAt: string;
        createdBy: string | null;
        updatedAt: string;
        updatedBy: string | null;
        id: string;
        tenantId: string;
        departmentId: string | null;
        startDate: string;
        documentKey: string | null;
        personalEmail: string | null;
        phone: string | null;
        nationalId: string | null;
        dateOfBirth: string | null;
        address: {
            line1: string;
            city: string;
            postalCode: string;
            country: string;
            line2?: string | undefined;
        } | null;
        employeeNumber: string;
        userId: string | null;
        firstName: string;
        lastName: string;
        workEmail: string;
        contractType: "permanent" | "fixed_term" | "contractor" | "intern" | "apprentice";
        jobTitle: string;
        managerId: string | null;
        endDate: string | null;
        salary: {
            amountMinor: number;
            currency: string;
        } | null;
    }>;
};
export type EmployeePage = Page<Employee>;
//# sourceMappingURL=api.d.ts.map