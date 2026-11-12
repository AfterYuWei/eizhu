import {beforeEach,expect,it,vi} from 'vitest'
const {api}=vi.hoisted(()=>({api:{createSession:vi.fn(),closeSession:vi.fn(),getSession:vi.fn(),list:vi.fn(),tree:vi.fn()}}))
vi.mock('@/api/sftp',()=>({sftpApi:api}))
import {createSftpStore} from './sftp'
import {setWorkspaceGeneration} from '@/lib/workspaceScope'
beforeEach(()=>{vi.resetAllMocks();setWorkspaceGeneration(1);api.closeSession.mockResolvedValue(undefined);api.list.mockImplementation(async(_id,path)=>({path,entries:[]}));api.createSession.mockResolvedValue({session_id:'new',status:'connected',home_dir:'/home'})})
it('刷新失联会话会重新连接并恢复原目录',async()=>{
 const store=createSftpStore();const tab=store.getState().leftTabs[0];store.setState({leftTabs:[{...tab,sessionId:'old',path:'/work'}]});api.getSession.mockResolvedValue({status:'disconnected'});await store.getState().refresh('left');expect(api.closeSession).toHaveBeenCalledWith('old');expect(api.createSession).toHaveBeenCalledWith('local');expect(store.getState().leftTabs[0]).toMatchObject({sessionId:'new',path:'/work',error:null});expect(api.list).toHaveBeenLastCalledWith('new','/work',false)
})

it('失联事件立即结束加载并保留目录，迟到的目录结果不能覆盖失联状态', async () => {
  const store = createSftpStore(), tab = store.getState().leftTabs[0]
  store.setState({ leftTabs: [{ ...tab, sessionId: 'old', path: '/work' }] })
  let resolve!: (value: { path: string; entries: [] }) => void
  api.list.mockReturnValue(new Promise((done) => { resolve = done }))
  const pending = store.getState().navigate('left', '/next')
  store.getState().acceptSessionStatus('old', 'disconnected')
  expect(store.getState().leftTabs[0]).toMatchObject({ path: '/work', connectionLost: true, loading: false })
  resolve({ path: '/next', entries: [] })
  await pending
  expect(store.getState().leftTabs[0]).toMatchObject({ path: '/work', connectionLost: true, loading: false })
})

it('重连失败后再次重连仍直接恢复原目录，不先跳回主目录', async () => {
  const store = createSftpStore(), tab = store.getState().leftTabs[0]
  store.setState({ leftTabs: [{ ...tab, sessionId: 'old', path: '/work', showHidden: true }] })
  api.getSession.mockResolvedValue({ status: 'disconnected' })
  api.createSession.mockRejectedValueOnce(new Error('网络暂不可用'))
  await store.getState().refresh('left')
  expect(store.getState().leftTabs[0].path).toBe('/work')
  await store.getState().refresh('left')
  expect(api.list).toHaveBeenCalledExactlyOnceWith('new', '/work', true)
  expect(store.getState().leftTabs[0]).toMatchObject({ path: '/work', sessionId: 'new', error: null, connectionLost: false })
})

it('目录读取失败保留最后成功路径', async () => {
  const store = createSftpStore(), tab = store.getState().leftTabs[0]
  store.setState({ leftTabs: [{ ...tab, sessionId: 'old', path: '/work' }] })
  api.list.mockRejectedValue(new Error('文件连接已断开'))
  await store.getState().navigate('left', '/next')
  expect(store.getState().leftTabs[0]).toMatchObject({ path: '/work', loading: false, error: '文件连接已断开' })
})

it('重连保留树形视图并清理旧连接的目录树', async () => {
  const store = createSftpStore(), tab = store.getState().leftTabs[0]
  const oldTree = { entry: { name: '/', path: '/', is_dir: true, size: 0, mod_time: '' }, children: [] }
  store.setState({ leftTabs: [{ ...tab, sessionId: 'old', path: '/work', view: 'tree', tree: oldTree }] })
  api.getSession.mockResolvedValue({ status: 'disconnected' })
  api.tree.mockResolvedValue({ path: '/', entries: [] })
  await store.getState().refresh('left')
  expect(store.getState().leftTabs[0]).toMatchObject({ sessionId: 'new', path: '/work', view: 'tree', loading: false, connectionLost: false })
  expect(api.tree).toHaveBeenCalledExactlyOnceWith('new', '/', 3)
  expect(store.getState().leftTabs[0].tree).not.toBe(oldTree)
})

it('刷新等待状态响应时切换标签，重连仍只更新原标签', async () => {
  const store = createSftpStore(), tab = store.getState().leftTabs[0]
  store.setState({ leftTabs: [{ ...tab, sessionId: 'old', path: '/work' }, { ...tab, id: 'other', sessionId: 'other-session', path: '/other' }] })
  let resolve!: (value: { status: string }) => void
  api.getSession.mockReturnValue(new Promise((done) => { resolve = done }))
  const pending = store.getState().refresh('left')
  store.getState().setActiveTab('left', 'other')
  resolve({ status: 'disconnected' })
  await pending
  expect(store.getState().activeLeftTabId).toBe('other')
  expect(store.getState().leftTabs[1]).toMatchObject({ sessionId: 'other-session', path: '/other' })
  expect(store.getState().leftTabs[0]).toMatchObject({ sessionId: 'new', path: '/work', loading: false })
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
