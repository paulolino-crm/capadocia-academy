// ================================================
// js/app.js — Capadócia Academy
// ================================================

import { createClient } from 
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

// 🔑 SUAS CREDENCIAIS (já identificadas!)
const SUPABASE_URL = 'https://volxtgqwdrcqrrxcfpcv.supabase.co'
const SUPABASE_KEY = 'sb_publishable_Ew_M-Hmi7qxXJUCnN2ZEuw_i_CJ1feQ'
// 

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// AUTENTICAÇÃO
export async function verificarSessao() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    window.location.href = '/login.html'
    return null
  }
  return session
}

export async function getMeuPerfil() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase
    .from('perfis')
    .select('*')
    .eq('id', user.id)
    .single()
  return data
}

export async function logout() {
  await supabase.auth.signOut()
  window.location.href = '/login.html'
}

// DASHBOARD
export async function getMetricasDashboard() {
  const [
    { count: totalAlunos },
    { data: receitaData },
    { count: pagPendentes },
    { count: cursosAtivos }
  ] = await Promise.all([
    supabase.from('perfis')
      .select('*', { count: 'exact', head: true })
      .eq('tipo', 'aluno').eq('ativo', true),
    supabase.from('transacoes')
      .select('valor')
      .eq('tipo', 'entrada')
      .eq('status', 'recebido'),
    supabase.from('transacoes')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pendente'),
    supabase.from('cursos')
      .select('*', { count: 'exact', head: true })
      .eq('ativo', true)
  ])

  const receitaTotal = receitaData?.reduce(
    (acc, t) => acc + Number(t.valor), 0
  ) || 0

  return {
    totalAlunos:  totalAlunos  || 0,
    receitaTotal,
    pagPendentes: pagPendentes || 0,
    cursosAtivos: cursosAtivos || 0
  }
}

export async function getMatriculasRecentes(limite = 5) {
  const { data, error } = await supabase
    .from('matriculas')
    .select(`
      id, status, criado_em, matricula_num,
      aluno:perfis!aluno_id (nome, foto_url),
      curso:cursos (nome, icone)
    `)
    .order('criado_em', { ascending: false })
    .limit(limite)
  if (error) throw error
  return data || []
}

// ALUNOS
export async function getTodosAlunos(pagina = 1, porPagina = 10) {
  const inicio = (pagina - 1) * porPagina
  const { data, count, error } = await supabase
    .from('perfis')
    .select(`
      *,
      matriculas (
        id, status, plano, matricula_num,
        curso:cursos (nome, icone)
      )
    `, { count: 'exact' })
    .eq('tipo', 'aluno')
    .order('nome')
    .range(inicio, inicio + porPagina - 1)
  if (error) throw error
  return { alunos: data || [], total: count || 0 }
}

export async function buscarAlunos(termo) {
  const { data, error } = await supabase
    .from('perfis')
    .select('*, matriculas(status, curso:cursos(nome))')
    .eq('tipo', 'aluno')
    .or(`nome.ilike.%${termo}%,email.ilike.%${termo}%`)
    .limit(20)
  if (error) throw error
  return data || []
}

// MATRÍCULAS
export async function criarAlunoEMatricula({
  nome, email, telefone, cursoIds, plano
}) {
  const senhaTemp = Math.random().toString(36).slice(-8) + 'Aa1!'

  const { data: authData, error: authErr } =
    await supabase.auth.signUp({
      email, password: senhaTemp,
      options: {
        emailRedirectTo:
          `${window.location.origin}/login.html`
      }
    })
  if (authErr) throw new Error('Erro ao criar conta: ' + authErr.message)

  const userId = authData.user.id

  await supabase.from('perfis')
    .insert([{ id: userId, nome, email, telefone, tipo: 'aluno' }])

  const { count } = await supabase
    .from('matriculas')
    .select('*', { count: 'exact', head: true })

  const matriculasCriadas = []
  for (let i = 0; i < cursoIds.length; i++) {
    const num = `CAP-${new Date().getFullYear()}-${
      String((count || 0) + i + 1).padStart(3, '0')}`

    const { data: cursoData } = await supabase
      .from('cursos').select('preco_mensal')
      .eq('id', cursoIds[i]).single()

    const { data: mat } = await supabase
      .from('matriculas')
      .insert([{
        aluno_id:          userId,
        curso_id:          cursoIds[i],
        plano,
        matricula_num:     num,
        status:            'ativa',
        valor_mensalidade: cursoData?.preco_mensal
      }]).select()

    matriculasCriadas.push(mat[0])

    await supabase.from('transacoes').insert([{
      aluno_id:        userId,
      matricula_id:    mat[0].id,
      descricao:       `Taxa de matrícula — ${num}`,
      valor:           150.00,
      tipo:            'entrada',
      categoria:       'matricula',
      status:          'pendente',
      data_vencimento: new Date().toISOString().split('T')[0]
    }])
  }
  return { userId, matriculas: matriculasCriadas, senhaTemp }
}

// FINANCEIRO
export async function getTransacoes({ status, tipo, pagina = 1 } = {}) {
  const inicio = (pagina - 1) * 10
  let query = supabase
    .from('transacoes')
    .select(`
      *,
      aluno:perfis!aluno_id (nome, foto_url),
      matricula:matriculas (matricula_num)
    `, { count: 'exact' })
    .order('criado_em', { ascending: false })
    .range(inicio, inicio + 9)

  if (status) query = query.eq('status', status)
  if (tipo)   query = query.eq('tipo', tipo)

  const { data, count, error } = await query
  if (error) throw error
  return { transacoes: data || [], total: count || 0 }
}

export async function criarLancamento({
  alunoId, matriculaId, descricao,
  valor, tipo, categoria, dataVencimento
}) {
  const { data, error } = await supabase
    .from('transacoes')
    .insert([{
      aluno_id:        alunoId,
      matricula_id:    matriculaId,
      descricao,
      valor:           Number(valor),
      tipo,
      categoria,
      status:          'pendente',
      data_vencimento: dataVencimento
    }]).select()
  if (error) throw error
  return data[0]
}

export async function registrarPagamento(transacaoId) {
  const hoje = new Date().toISOString().split('T')[0]
  const { data, error } = await supabase
    .from('transacoes')
    .update({ status: 'recebido', data_pagamento: hoje })
    .eq('id', transacaoId).select()
  if (error) throw error
  return data[0]
}

// UTILITÁRIOS
export function formatarMoeda(valor) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL'
  }).format(valor || 0)
}

export function formatarData(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('pt-BR')
}

export function badgeStatus(status) {
  const map = {
    ativa:        'bg-green-100 text-green-700',
    pendente:     'bg-amber-100 text-amber-700',
    inativa:      'bg-slate-100 text-slate-500',
    concluida:    'bg-blue-100 text-blue-700',
    recebido:     'bg-emerald-100 text-emerald-700',
    atrasado:     'bg-red-100 text-red-700',
    reembolsado:  'bg-slate-200 text-slate-600'
  }
  return map[status] || 'bg-slate-100 text-slate-500'
}

export function iniciais(nome) {
  if (!nome) return '?'
  return nome.split(' ').slice(0, 2)
    .map(n => n[0]).join('').toUpperCase()
}