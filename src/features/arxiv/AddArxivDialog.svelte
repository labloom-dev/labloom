<script lang="ts">
  import Modal from '../../components/Modal.svelte'
  import { buildArxivUrl } from './arxiv'

  interface Props {
    onclose: () => void
    onsubmit: (value: { title: string; feedUrl: string }) => Promise<void>
  }

  let { onclose, onsubmit }: Props = $props()
  let title = $state('')
  let categories = $state('cs.AI, cs.LG')
  let keywords = $state('')
  let author = $state('')
  let maxResults = $state(50)
  let loading = $state(false)
  let error = $state('')

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    error = ''
    if (!title.trim()) {
      error = '请填写订阅名称'
      return
    }
    try {
      loading = true
      const feedUrl = buildArxivUrl({ categories, keywords, author, maxResults })
      await onsubmit({ title: title.trim(), feedUrl })
      onclose()
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      loading = false
    }
  }
</script>

<Modal title="添加 arXiv 订阅" {onclose} width="520px">
  <form onsubmit={submit}>
    <label>
      <span>订阅名称</span>
      <input bind:value={title} required placeholder="例如：机器人学习" />
    </label>
    <label>
      <span>分类</span>
      <input bind:value={categories} placeholder="cs.AI, cs.LG, cs.RO" />
      <small>多个分类使用逗号或空格分隔</small>
    </label>
    <div class="row">
      <label>
        <span>关键词（可选）</span>
        <input bind:value={keywords} placeholder="flow matching" />
      </label>
      <label>
        <span>作者（可选）</span>
        <input bind:value={author} placeholder="作者姓名" />
      </label>
    </div>
    <label class="max-results">
      <span>每次结果数</span>
      <input bind:value={maxResults} type="number" min="1" max="100" required />
    </label>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <footer>
      <button type="button" class="secondary" onclick={onclose}>取消</button>
      <button type="submit" class="primary" disabled={loading}>{loading ? '添加中…' : '添加订阅'}</button>
    </footer>
  </form>
</Modal>

<style>
  form { display: grid; gap: 15px; }
  label { display: grid; gap: 6px; }
  label span { color: var(--text-muted); font-size: 12px; font-weight: 550; }
  label small { color: var(--text-subtle); font-size: 10px; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .max-results { width: 150px; }
  .error { margin: -2px 0 0; color: var(--danger); font-size: 12px; }
  footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 3px; }
</style>
