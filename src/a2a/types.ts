/**
 * A2A Protocol Types
 *
 * TypeScript type definitions for the Agent-to-Agent (A2A) Protocol
 * Based on the A2A Protocol Specification RC v1.0
 * @see https://a2a-protocol.org/latest/specification/
 */

// ============================================================================
// 4.1 Core Objects
// ============================================================================

/**
 * 4.1.3 TaskState - Lifecycle states of a Task
 */
export type TaskState =
	| 'TASK_STATE_UNSPECIFIED'
	| 'TASK_STATE_SUBMITTED'
	| 'TASK_STATE_WORKING'
	| 'TASK_STATE_COMPLETED'
	| 'TASK_STATE_FAILED'
	| 'TASK_STATE_CANCELED'
	| 'TASK_STATE_INPUT_REQUIRED'
	| 'TASK_STATE_REJECTED'
	| 'TASK_STATE_AUTH_REQUIRED'

/**
 * Terminal states where no further processing occurs
 */
export const TERMINAL_STATES: ReadonlySet<TaskState> = new Set([
	'TASK_STATE_COMPLETED',
	'TASK_STATE_FAILED',
	'TASK_STATE_CANCELED',
	'TASK_STATE_REJECTED'
])

/**
 * Interrupted states where the task is paused awaiting input
 */
export const INTERRUPTED_STATES: ReadonlySet<TaskState> = new Set([
	'TASK_STATE_INPUT_REQUIRED',
	'TASK_STATE_AUTH_REQUIRED'
])

/**
 * 4.1.5 Role - Identifies the sender of a message
 */
export type Role = 'ROLE_UNSPECIFIED' | 'ROLE_USER' | 'ROLE_AGENT'

/**
 * 4.1.6 Part - Smallest unit of content
 * A Part MUST contain exactly one of: text, raw, url, data
 */
export type Part = {
	/** Text content */
	text?: string
	/** Raw binary data (base64 encoded) */
	raw?: string
	/** URL reference */
	url?: string
	/** Structured data */
	data?: Record<string, unknown>
	/** File content */
	file?: FileContent
	/**
	 * MIME type of the part content
	 * e.g., "text/plain", "application/json", "image/png"
	 */
	mediaType?: string
	/** Optional metadata */
	metadata?: Record<string, unknown>
}

/**
 * File content within a Part
 */
export type FileContent = {
	/** File name */
	name?: string
	/** MIME type */
	mediaType?: string
	/** Base64-encoded file bytes */
	fileWithBytes?: string
	/** URI to the file */
	fileWithUri?: string
}

/**
 * 4.1.4 Message - One unit of communication
 */
export type Message = {
	/** Unique identifier (UUID) for the message */
	messageId: string
	/** Optional context ID */
	contextId?: string
	/** Optional task ID */
	taskId?: string
	/** Sender role */
	role: Role
	/** Content parts */
	parts: Part[]
	/** Optional metadata */
	metadata?: Record<string, unknown>
	/** Extension URIs present in this message */
	extensions?: string[]
	/** Referenced task IDs for additional context */
	referenceTaskIds?: string[]
}

/**
 * 4.1.2 TaskStatus - Container for task status
 */
export type TaskStatus = {
	/** Current state */
	state: TaskState
	/** Associated message */
	message?: Message
	/** ISO 8601 timestamp */
	timestamp?: string
}

/**
 * 4.1.7 Artifact - Task output
 */
export type Artifact = {
	/** Unique identifier (at least unique within a task) */
	artifactId: string
	/** Human-readable name */
	name?: string
	/** Human-readable description */
	description?: string
	/** Content parts (must contain at least one) */
	parts: Part[]
	/** Optional metadata */
	metadata?: Record<string, unknown>
	/** Extension URIs */
	extensions?: string[]
}

/**
 * 4.1.1 Task - Core unit of work
 */
export type Task = {
	/** Unique identifier (UUID), server-generated */
	id: string
	/** Context identifier (UUID), server-generated */
	contextId: string
	/** Current status */
	status: TaskStatus
	/** Output artifacts */
	artifacts?: Artifact[]
	/** Interaction history */
	history?: Message[]
	/** Custom metadata */
	metadata?: Record<string, unknown>
}

// ============================================================================
// 4.2 Streaming Events
// ============================================================================

/**
 * 4.2.1 TaskStatusUpdateEvent
 */
export type TaskStatusUpdateEvent = {
	/** Task ID */
	taskId: string
	/** Context ID */
	contextId: string
	/** New status */
	status: TaskStatus
	/** Optional metadata */
	metadata?: Record<string, unknown>
}

/**
 * 4.2.2 TaskArtifactUpdateEvent
 */
export type TaskArtifactUpdateEvent = {
	/** Task ID */
	taskId: string
	/** Context ID */
	contextId: string
	/** Generated/updated artifact */
	artifact: Artifact
	/** If true, append to previously sent artifact with same ID */
	append?: boolean
	/** If true, this is the final chunk */
	lastChunk?: boolean
	/** Optional metadata */
	metadata?: Record<string, unknown>
}

/**
 * 3.2.3 StreamResponse - Wrapper for streaming events
 * MUST contain exactly one of the fields
 */
export type StreamResponse = {
	task?: Task
	message?: Message
	statusUpdate?: TaskStatusUpdateEvent
	artifactUpdate?: TaskArtifactUpdateEvent
}

// ============================================================================
// 4.3 Push Notification Objects
// ============================================================================

/**
 * 4.3.2 AuthenticationInfo
 */
export type AuthenticationInfo = {
	/** HTTP Authentication Scheme (Bearer, Basic, Digest) */
	scheme: string
	/** Credentials for the scheme */
	credentials?: string
}

/**
 * 4.3.1 PushNotificationConfig
 */
export type PushNotificationConfig = {
	/** Unique identifier */
	id?: string
	/** Webhook URL */
	url: string
	/** Token for this task/session */
	token?: string
	/** Authentication info */
	authentication?: AuthenticationInfo
}

/**
 * TaskPushNotificationConfig - Associates config with a task
 */
export type TaskPushNotificationConfig = {
	/** Config ID */
	id: string
	/** Parent task ID */
	taskId: string
	/** The config */
	pushNotificationConfig: PushNotificationConfig
}

// ============================================================================
// 4.4 Agent Discovery Objects
// ============================================================================

/**
 * 4.4.2 AgentProvider
 */
export type AgentProvider = {
	/** Organization name */
	organization: string
	/** URL */
	url?: string
}

/**
 * 4.4.4 AgentExtension
 */
export type AgentExtension = {
	/** Extension URI */
	uri: string
	/** Description */
	description?: string
	/** Whether extension is required */
	required?: boolean
}

/**
 * 4.4.3 AgentCapabilities
 */
export type AgentCapabilities = {
	/** Supports streaming responses */
	streaming?: boolean
	/** Supports push notifications */
	pushNotifications?: boolean
	/** Supported extensions */
	extensions?: AgentExtension[]
	/** Supports extended agent card */
	extendedAgentCard?: boolean
}

/**
 * 4.4.5 AgentSkill
 */
export type AgentSkill = {
	/** Unique identifier */
	id: string
	/** Human-readable name */
	name: string
	/** Detailed description */
	description: string
	/** Keywords describing capabilities */
	tags: string[]
	/** Example prompts */
	examples?: string[]
	/** Supported input media types (overrides agent defaults) */
	inputModes?: string[]
	/** Supported output media types (overrides agent defaults) */
	outputModes?: string[]
}

/**
 * 4.4.6 AgentInterface
 */
export type AgentInterface = {
	/** URL where this interface is available */
	url: string
	/** Protocol binding: JSONRPC, GRPC, HTTP+JSON */
	protocolBinding: string
	/** Optional tenant */
	tenant?: string
	/** A2A protocol version */
	protocolVersion: string
}

/**
 * 4.4.7 AgentCardSignature
 */
export type AgentCardSignature = {
	/** Base64url-encoded protected JWS header */
	protected: string
	/** Base64url-encoded signature */
	signature: string
	/** Unprotected JWS header */
	header?: Record<string, unknown>
}

// ============================================================================
// 4.5 Security Objects
// ============================================================================

/**
 * 4.5 SecurityScheme (simplified union)
 */
export type SecurityScheme = {
	/** API Key security */
	apiKeySecurityScheme?: {
		description?: string
		name: string
		in: 'query' | 'header' | 'cookie'
	}
	/** HTTP security (Bearer, Basic, etc.) */
	httpSecurityScheme?: {
		description?: string
		scheme: string
		bearerFormat?: string
	}
	/** OpenID Connect */
	openIdConnectSecurityScheme?: {
		description?: string
		openIdConnectUrl: string
	}
	/** OAuth2 */
	oauth2SecurityScheme?: {
		description?: string
		flows: Record<string, unknown>
	}
}

/**
 * Security requirement - maps scheme name to required scopes
 */
export type SecurityRequirement = Record<string, string[]>

/**
 * 4.4.1 AgentCard - Self-describing agent manifest
 */
export type AgentCard = {
	/** Human-readable agent name */
	name: string
	/** Agent description */
	description: string
	/** Supported protocol interfaces */
	supportedInterfaces: AgentInterface[]
	/** Service provider info */
	provider?: AgentProvider
	/** Agent version */
	version: string
	/** Documentation URL */
	documentationUrl?: string
	/** Agent capabilities */
	capabilities: AgentCapabilities
	/** Security scheme definitions */
	securitySchemes?: Record<string, SecurityScheme>
	/** Security requirements */
	security?: SecurityRequirement[]
	/** Default accepted input media types */
	defaultInputModes: string[]
	/** Default output media types */
	defaultOutputModes: string[]
	/** Agent skills */
	skills: AgentSkill[]
	/** Digital signatures */
	signatures?: AgentCardSignature[]
	/** Icon URL */
	iconUrl?: string
}

// ============================================================================
// 3.2 Operation Parameter Objects
// ============================================================================

/**
 * 3.2.2 SendMessageConfiguration
 */
export type SendMessageConfiguration = {
	/** Accepted output media types */
	acceptedOutputModes?: string[]
	/** Push notification config */
	pushNotificationConfig?: PushNotificationConfig
	/** Max history messages to include */
	historyLength?: number
	/**
	 * If true, wait until terminal/interrupted state before returning.
	 * Default is false.
	 */
	blocking?: boolean
}

/**
 * 3.2.1 SendMessageRequest
 */
export type SendMessageRequest = {
	/** Optional tenant */
	tenant?: string
	/** The message to send */
	message: Message
	/** Request configuration */
	configuration?: SendMessageConfiguration
	/** Additional metadata */
	metadata?: Record<string, unknown>
}

/**
 * SendMessageResponse - Contains either a Task or a Message
 */
export type SendMessageResponse = {
	task?: Task
	message?: Message
}

/**
 * GetTaskRequest
 */
export type GetTaskRequest = {
	tenant?: string
	id: string
	historyLength?: number
}

/**
 * ListTasksRequest
 */
export type ListTasksRequest = {
	tenant?: string
	contextId?: string
	status?: TaskState
	pageSize?: number
	pageToken?: string
	historyLength?: number
	statusTimestampAfter?: string
	includeArtifacts?: boolean
}

/**
 * ListTasksResponse
 */
export type ListTasksResponse = {
	tasks: Task[]
	nextPageToken: string
	pageSize: number
	totalSize: number
}

/**
 * CancelTaskRequest
 */
export type CancelTaskRequest = {
	tenant?: string
	id: string
}

/**
 * SubscribeToTaskRequest
 */
export type SubscribeToTaskRequest = {
	tenant?: string
	id: string
}

/**
 * CreateTaskPushNotificationConfigRequest
 */
export type CreateTaskPushNotificationConfigRequest = {
	tenant?: string
	taskId: string
	configId: string
	config: PushNotificationConfig
}

/**
 * GetTaskPushNotificationConfigRequest
 */
export type GetTaskPushNotificationConfigRequest = {
	tenant?: string
	taskId: string
	id: string
}

/**
 * ListTaskPushNotificationConfigRequest
 */
export type ListTaskPushNotificationConfigRequest = {
	tenant?: string
	taskId: string
	pageSize?: number
	pageToken?: string
}

/**
 * ListTaskPushNotificationConfigResponse
 */
export type ListTaskPushNotificationConfigResponse = {
	configs: TaskPushNotificationConfig[]
	nextPageToken?: string
}

/**
 * DeleteTaskPushNotificationConfigRequest
 */
export type DeleteTaskPushNotificationConfigRequest = {
	tenant?: string
	taskId: string
	id: string
}

// ============================================================================
// JSON-RPC 2.0 Types
// ============================================================================

/**
 * JSON-RPC 2.0 Request
 */
export type JsonRpcRequest = {
	jsonrpc: '2.0'
	id: string | number
	method: string
	params?: Record<string, unknown>
}

/**
 * JSON-RPC 2.0 Success Response
 */
export type JsonRpcSuccessResponse = {
	jsonrpc: '2.0'
	id: string | number
	result: unknown
}

/**
 * JSON-RPC 2.0 Error Object
 */
export type JsonRpcErrorObject = {
	code: number
	message: string
	data?: unknown
}

/**
 * JSON-RPC 2.0 Error Response
 */
export type JsonRpcErrorResponse = {
	jsonrpc: '2.0'
	id: string | number | null
	error: JsonRpcErrorObject
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse

// ============================================================================
// Plugin Configuration Types
// ============================================================================

/**
 * Handler context provided to user-defined message handlers
 */
export type A2AHandlerContext = {
	/** The incoming message */
	message: Message
	/** The task being worked on (available for follow-up messages) */
	task?: Task
	/** Request configuration from the client */
	configuration?: SendMessageConfiguration
	/** Request metadata */
	metadata?: Record<string, unknown>
}

/**
 * Result returned by a message handler for simple (non-streaming) responses
 */
export type A2AHandlerResult = {
	/**
	 * If set, the response will be a direct Message (no task tracking).
	 * Mutually exclusive with artifacts/state.
	 */
	directMessage?: {
		parts: Part[]
		metadata?: Record<string, unknown>
	}
	/**
	 * Artifacts to attach to the task.
	 * The plugin will create/update the task automatically.
	 */
	artifacts?: Artifact[]
	/**
	 * Final task state. Defaults to TASK_STATE_COMPLETED if artifacts are provided.
	 */
	state?: TaskState
	/**
	 * Optional status message
	 */
	statusMessage?: {
		parts: Part[]
		metadata?: Record<string, unknown>
	}
	/**
	 * Task metadata
	 */
	metadata?: Record<string, unknown>
}

/**
 * Streaming event yielded by the streaming handler
 */
export type A2AStreamEvent =
	| {
			type: 'status'
			state: TaskState
			message?: { parts: Part[]; metadata?: Record<string, unknown> }
	  }
	| {
			type: 'artifact'
			artifact: Artifact
			append?: boolean
			lastChunk?: boolean
	  }

/**
 * Task store interface for pluggable persistence
 */
export interface TaskStore {
	/** Create or update a task */
	upsert(task: Task): Promise<void>
	/** Get a task by ID */
	get(id: string): Promise<Task | undefined>
	/** List tasks with optional filtering */
	list(params: {
		contextId?: string
		status?: TaskState
		pageSize?: number
		pageToken?: string
		statusTimestampAfter?: string
	}): Promise<{ tasks: Task[]; nextPageToken: string; totalSize: number }>
	/** Delete a task */
	delete(id: string): Promise<boolean>

	/** Push notification config CRUD */
	createPushConfig(
		taskId: string,
		configId: string,
		config: PushNotificationConfig
	): Promise<TaskPushNotificationConfig>
	getPushConfig(
		taskId: string,
		configId: string
	): Promise<TaskPushNotificationConfig | undefined>
	listPushConfigs(
		taskId: string
	): Promise<TaskPushNotificationConfig[]>
	deletePushConfig(taskId: string, configId: string): Promise<boolean>
}

/**
 * A2A Plugin Options
 */
export type A2APluginOptions = {
	/**
	 * Agent configuration used to build the Agent Card.
	 */
	agent: {
		name: string
		description: string
		version: string
		provider?: AgentProvider
		documentationUrl?: string
		iconUrl?: string
		skills: AgentSkill[]
		/** Default input media types. Defaults to ['text/plain', 'application/json'] */
		defaultInputModes?: string[]
		/** Default output media types. Defaults to ['text/plain', 'application/json'] */
		defaultOutputModes?: string[]
		/** Security scheme definitions */
		securitySchemes?: Record<string, SecurityScheme>
		/** Security requirements */
		security?: SecurityRequirement[]
		/** Extensions supported */
		extensions?: AgentExtension[]
	}

	/**
	 * Base path to mount the A2A endpoints on.
	 * Defaults to '' (root).
	 */
	basePath?: string

	/**
	 * Capabilities to declare. Streaming and push notifications
	 * are auto-detected based on handler presence but can be overridden.
	 */
	capabilities?: {
		streaming?: boolean
		pushNotifications?: boolean
		extendedAgentCard?: boolean
	}

	/**
	 * Custom task store. Defaults to in-memory.
	 */
	taskStore?: TaskStore

	/**
	 * Main message handler.
	 * Called when a client sends a message (SendMessage).
	 * Return a result describing the response.
	 */
	onMessage: (context: A2AHandlerContext) => Promise<A2AHandlerResult>

	/**
	 * Streaming message handler.
	 * Called when a client sends a streaming message (SendStreamingMessage).
	 * Yield streaming events.
	 * If not provided, streaming capability will be disabled.
	 */
	onStreamMessage?: (
		context: A2AHandlerContext
	) => AsyncGenerator<A2AStreamEvent, void, unknown>

	/**
	 * Called when a task cancellation is requested.
	 * Return true if cancellation was successful.
	 */
	onCancelTask?: (taskId: string) => Promise<boolean>

	/**
	 * Optional: Return an extended agent card for authenticated clients.
	 * Only called if capabilities.extendedAgentCard is true.
	 */
	onGetExtendedAgentCard?: (
		request: Request
	) => Promise<AgentCard | undefined>
}
