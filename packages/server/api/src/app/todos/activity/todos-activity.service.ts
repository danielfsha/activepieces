import { ActivepiecesError, ApId, apId, Cursor, ErrorCode, isNil, PlatformId, ProjectId, RichContentBlock, SeekPage, spreadIfDefined, TodoActivity, TodoActivityWithUser, UserId } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { Socket } from 'socket.io'
import { agentsService } from '../../agents/agents-service'
import { repoFactory } from '../../core/db/repo-factory'
import { buildPaginator } from '../../helper/pagination/build-paginator'
import { paginationHelper } from '../../helper/pagination/pagination-utils'
import { Order } from '../../helper/pagination/paginator'
import { userService } from '../../user/user-service'
import { todoSideEfffects } from '../todo-side-effects'
import { TodoActivityEntity } from './todos-activity.entity'

const repo = repoFactory(TodoActivityEntity)

export const todoActivitiesService = (log: FastifyBaseLogger) => ({
    async create(params: CreateParams): Promise<TodoActivity> {
        const activity = repo().create({
            id: apId(),
            ...params,
        })
        const savedActivity = await repo().save(activity)
        await todoSideEfffects(log).notifyActivityCreated({
            socket: params.socket,
            todoId: params.todoId,
            projectId: params.projectId,
        })
        return savedActivity
    },
    async update(params: UpdateParams): Promise<TodoActivity> {
        const activity = await repo().findOneByOrFail({ id: params.id })
        await repo().update(activity.id, {
            ...spreadIfDefined('content', params.content),
        })
        await todoSideEfffects(log).notifyActivity({
            socket: params.socket,
            projectId: params.projectId,
            activityId: params.id,
            todoId: activity.todoId,
            content: params.content,
        })
        return this.getOneOrThrow({ id: params.id })
    },
    async getOne(params: GetParams): Promise<TodoActivity | null> {
        return repo().findOneBy({ id: params.id })
    },
    async getOneOrThrow(params: GetParams): Promise<TodoActivity> {
        const todoActivity = await this.getOne(params)
        if (!todoActivity) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: { entityType: 'todo_activity', entityId: params.id, message: 'Todo activity by id not found' },
            })
        }
        return todoActivity
    },
    async list(params: ListParams): Promise<SeekPage<TodoActivityWithUser>> {
        const decodedCursor = paginationHelper.decodeCursor(params.cursor)
        const paginator = buildPaginator<TodoActivity>({
            entity: TodoActivityEntity,
            query: {
                limit: params.limit,
                order: Order.ASC,
                orderBy: 'created',
                afterCursor: decodedCursor.nextCursor,
                beforeCursor: decodedCursor.previousCursor,
            },
        })

        const query = repo().createQueryBuilder('todo_activity').where({
            todoId: params.todoId,
        })

        const { data, cursor: newCursor } = await paginator.paginate(query)
        const enrichedData = await Promise.all(
            data.map(async (activity) => {
                return enrichTodoActivityWithUser(activity, log)
            }),
        )
        return paginationHelper.createPage<TodoActivityWithUser>(enrichedData, newCursor)
    },
})


async function enrichTodoActivityWithUser(
    activity: TodoActivity,
    log: FastifyBaseLogger,
): Promise<TodoActivityWithUser> {
    const user = isNil(activity.userId) ? null : await userService.getMetaInformation({
        id: activity.userId,
    })
    const agent = isNil(activity.agentId) ? null : await agentsService(log).getOne({
        id: activity.agentId,
    })
    return {
        ...activity,
        agent,
        user,
    }
}

type GetParams = {
    id: string
}

type ListParams = {
    platformId: PlatformId
    projectId: ProjectId
    todoId: ApId
    limit: number
    cursor: Cursor | null
}

type CreateParams = {
    content: RichContentBlock[]
    platformId: PlatformId
    projectId: ProjectId
    userId: UserId | null
    agentId: string | null
    todoId: ApId
    socket: Socket
}

type UpdateParams = {
    id: string
    content: RichContentBlock[]
    socket: Socket
    projectId: ProjectId
}