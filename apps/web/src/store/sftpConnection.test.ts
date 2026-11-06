import {beforeEach,expect,it,vi} from 'vitest'
const {api}=vi.hoisted(()=>({api:{createSession:vi.fn(),closeSession:vi.fn(),getSession:vi.fn(),list:vi.fn()}}))
vi.mock('@/api/sftp',()=>({sftpApi:api}))
import {createSftpStore} from './sftp'
import {setWorkspaceGeneration} from '@/lib/workspaceScope'
beforeEach(()=>{vi.resetAllMocks();setWorkspaceGeneration(1);api.closeSession.mockResolvedValue(undefined);api.list.mockImplementation(async(_id,path)=>({path,entries:[]}));api.createSession.mockResolvedValue({session_id:'new',status:'connected',home_dir:'/home'})})
it('刷新失联会话会重新连接并恢复原目录',async()=>{
 const store=createSftpStore();const tab=store.getState().leftTabs[0];store.setState({leftTabs:[{...tab,sessionId:'old',path:'/work'}]});api.getSession.mockResolvedValue({status:'disconnected'});await store.getState().refresh('left');expect(api.closeSession).toHaveBeenCalledWith('old');expect(api.createSession).toHaveBeenCalledWith('local');expect(store.getState().leftTabs[0]).toMatchObject({sessionId:'new',path:'/work',error:null});expect(api.list).toHaveBeenLastCalledWith('new','/work',false)
})
it('切换标签后旧目录响应只更新所属标签',async()=>{
 const store=createSftpStore(),first=store.getState().leftTabs[0],second={...first,id:'second',sessionId:'two',path:'/two'};store.setState({leftTabs:[{...first,sessionId:'one'},second]});let resolve!:(value:{path:string;entries:[]})=>void;api.list.mockReturnValue(new Promise(r=>{resolve=r}));const pending=store.getState().navigate('left','/new');store.getState().setActiveTab('left','second');resolve({path:'/new',entries:[]});await pending;expect(store.getState().activeLeftTabId).toBe('second');expect(store.getState().leftTabs[1].path).toBe('/two');expect(store.getState().leftTabs[0]).toMatchObject({path:'/new',loading:false})
})
it('旧空间的视图不能发起新连接',async()=>{
 const store=createSftpStore();setWorkspaceGeneration(2);await store.getState().connectServer('left',store.getState().leftTabs[0].server);await store.getState().refresh('left');expect(api.createSession).not.toHaveBeenCalled();expect(api.getSession).not.toHaveBeenCalled()
})

it('同一个内部标签连接中重复打开只创建一次会话', async () => {
  const store = createSftpStore()
  const server = store.getState().leftTabs[0].server
  let resolve!: (value: { session_id: string; status: string; home_dir: string }) => void
  api.createSession.mockReturnValue(new Promise((done) => { resolve = done }))
  const first = store.getState().connectServer('left', server)
  const second = store.getState().connectServer('left', server)
  expect(api.createSession).toHaveBeenCalledTimes(1)
  resolve({ session_id: 'single', status: 'connected', home_dir: '/home' })
  await Promise.all([first, second])
  expect(store.getState().leftTabs).toHaveLength(1)
  expect(store.getState().leftTabs[0].sessionId).toBe('single')
})

it('释放幂等且等待尚未返回的会话创建完成后关闭，禁止再连接', async () => {
  const store = createSftpStore()
  const server = store.getState().leftTabs[0].server
  let resolve!: (value: { session_id: string; status: string; home_dir: string }) => void
  api.createSession.mockReturnValue(new Promise((done) => { resolve = done }))
  const pending = store.getState().connectServer('left', server)
  const disposal = store.getState().dispose()
  expect(store.getState().dispose()).toBe(disposal)
  let finished = false
  void disposal.then(() => { finished = true })
  await Promise.resolve()
  expect(finished).toBe(false)
  resolve({ session_id: 'late', status: 'connected', home_dir: '/home' })
  await Promise.all([pending, disposal])
  expect(api.closeSession).toHaveBeenCalledExactlyOnceWith('late')
  expect(api.list).not.toHaveBeenCalled()
  await store.getState().connectServer('left', server)
  expect(api.createSession).toHaveBeenCalledTimes(1)
})
