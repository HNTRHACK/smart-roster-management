import type { SchedulerInput } from '../scheduler/types.ts'
import type { SeedData } from './data.ts'

/** Seed rows → scheduler input for one month ("YYYY-MM"). Table keys already match. */
export function seedToSchedulerInput(data: SeedData, month: string): SchedulerInput {
  return {
    month,
    pods: data.pods,
    employees: data.employees,
    brands: data.brands,
    processes: data.processes,
    brand_processes: data.brand_processes,
    coverage_overrides: data.coverage_overrides,
    assignments: data.assignments,
    public_holidays: data.public_holidays,
    leaves: data.leaves,
  }
}
