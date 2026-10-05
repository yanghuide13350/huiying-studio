import { Hono } from 'hono'
import { deleteEpisodeMedia } from '../services/media-delete.js'
import { success, badRequest } from '../utils/response.js'
const app = new Hono()
app.post('/delete', async c => { try { return success(c, deleteEpisodeMedia(await c.req.json())) } catch (error) { return badRequest(c, error instanceof Error ? error.message : '删除失败') } })
export default app
