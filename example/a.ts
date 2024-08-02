import {
	sucrose,
	separateFunction,
	findParameterReference,
	extractMainParameter,
	isContextPassToFunction
} from '../src/sucrose'

const event = `async({user:z,params:{id:J},query:{conversation:G}})=>{const Q=await z.id;if(G)return setImmediate(()=>{O6.conversation.setActiveConversation(Q,J,G)}),O6.conversation.getChatsById(Q,J,G);return O6.conversation.getChats(Q,J)}`

const [parameter, body, { isArrowReturn }] = separateFunction(event.toString())

const inference = {
	body: false,
	cookie: false,
	headers: false,
	query: false,
	server: false,
	set: false
}

const rootParameters = findParameterReference(parameter, {
	body: false,
	cookie: false,
	headers: false,
	query: false,
	server: false,
	set: false
})
const mainParameter = extractMainParameter(rootParameters)

isContextPassToFunction(mainParameter!, body, inference)
