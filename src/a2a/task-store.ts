/**
 * A2A Task Store
 *
 * In-memory implementation of the TaskStore interface.
 * Production users can provide custom implementations backed by
 * databases (e.g., Cosmos DB, Redis, PostgreSQL).
 */

import type {
	Task,
	TaskState,
	TaskStore,
	PushNotificationConfig,
	TaskPushNotificationConfig,
	TERMINAL_STATES
} from './types'

/**
 * In-memory TaskStore implementation.
 *
 * Suitable for development, testing, and single-instance deployments.
 * For production multi-instance deployments, implement a custom TaskStore
 * backed by a persistent database.
 */
export class InMemoryTaskStore implements TaskStore {
	private tasks = new Map<string, Task>()
	private pushConfigs = new Map<string, Map<string, TaskPushNotificationConfig>>()
	/** Max number of tasks to keep in memory (LRU eviction) */
	private maxTasks: number
	/** Task access order for LRU eviction */
	private accessOrder: string[] = []

	constructor(options?: { maxTasks?: number }) {
		this.maxTasks = options?.maxTasks ?? 10000
	}

	async upsert(task: Task): Promise<void> {
		// Update LRU order
		const idx = this.accessOrder.indexOf(task.id)
		if (idx !== -1) {
			this.accessOrder.splice(idx, 1)
		}
		this.accessOrder.push(task.id)

		this.tasks.set(task.id, structuredClone(task))

		// Evict oldest tasks if exceeding limit
		while (this.accessOrder.length > this.maxTasks) {
			const oldest = this.accessOrder.shift()!
			this.tasks.delete(oldest)
			this.pushConfigs.delete(oldest)
		}
	}

	async get(id: string): Promise<Task | undefined> {
		const task = this.tasks.get(id)
		if (task) {
			// Update LRU
			const idx = this.accessOrder.indexOf(id)
			if (idx !== -1) {
				this.accessOrder.splice(idx, 1)
			}
			this.accessOrder.push(id)
			return structuredClone(task)
		}
		return undefined
	}

	async list(params: {
		contextId?: string
		status?: TaskState
		pageSize?: number
		pageToken?: string
		statusTimestampAfter?: string
	}): Promise<{ tasks: Task[]; nextPageToken: string; totalSize: number }> {
		let results = Array.from(this.tasks.values())

		// Apply filters
		if (params.contextId) {
			results = results.filter((t) => t.contextId === params.contextId)
		}
		if (params.status) {
			results = results.filter(
				(t) => t.status.state === params.status
			)
		}
		if (params.statusTimestampAfter) {
			const after = new Date(params.statusTimestampAfter).getTime()
			results = results.filter((t) => {
				if (!t.status.timestamp) return false
				return new Date(t.status.timestamp).getTime() >= after
			})
		}

		// Sort by status timestamp descending (most recent first)
		results.sort((a, b) => {
			const aTime = a.status.timestamp
				? new Date(a.status.timestamp).getTime()
				: 0
			const bTime = b.status.timestamp
				? new Date(b.status.timestamp).getTime()
				: 0
			return bTime - aTime
		})

		const totalSize = results.length
		const pageSize = Math.min(Math.max(params.pageSize || 50, 1), 100)

		// Simple cursor-based pagination using index
		let startIndex = 0
		if (params.pageToken) {
			startIndex = parseInt(params.pageToken, 10)
			if (isNaN(startIndex) || startIndex < 0) startIndex = 0
		}

		const page = results.slice(startIndex, startIndex + pageSize)
		const hasMore = startIndex + pageSize < totalSize
		const nextPageToken = hasMore
			? String(startIndex + pageSize)
			: ''

		return {
			tasks: page.map((t) => structuredClone(t)),
			nextPageToken,
			totalSize
		}
	}

	async delete(id: string): Promise<boolean> {
		const existed = this.tasks.delete(id)
		this.pushConfigs.delete(id)
		const idx = this.accessOrder.indexOf(id)
		if (idx !== -1) {
			this.accessOrder.splice(idx, 1)
		}
		return existed
	}

	// ========================================================================
	// Push Notification Config CRUD
	// ========================================================================

	async createPushConfig(
		taskId: string,
		configId: string,
		config: PushNotificationConfig
	): Promise<TaskPushNotificationConfig> {
		let taskConfigs = this.pushConfigs.get(taskId)
		if (!taskConfigs) {
			taskConfigs = new Map()
			this.pushConfigs.set(taskId, taskConfigs)
		}

		const entry: TaskPushNotificationConfig = {
			id: configId,
			taskId,
			pushNotificationConfig: { ...config, id: configId }
		}
		taskConfigs.set(configId, entry)
		return structuredClone(entry)
	}

	async getPushConfig(
		taskId: string,
		configId: string
	): Promise<TaskPushNotificationConfig | undefined> {
		const taskConfigs = this.pushConfigs.get(taskId)
		if (!taskConfigs) return undefined
		const config = taskConfigs.get(configId)
		return config ? structuredClone(config) : undefined
	}

	async listPushConfigs(
		taskId: string
	): Promise<TaskPushNotificationConfig[]> {
		const taskConfigs = this.pushConfigs.get(taskId)
		if (!taskConfigs) return []
		return Array.from(taskConfigs.values()).map((c) => structuredClone(c))
	}

	async deletePushConfig(taskId: string, configId: string): Promise<boolean> {
		const taskConfigs = this.pushConfigs.get(taskId)
		if (!taskConfigs) return false
		return taskConfigs.delete(configId)
	}
}
