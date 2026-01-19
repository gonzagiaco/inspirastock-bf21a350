import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DOLAR_API_URLS = {
  official: "https://dolarapi.com/v1/dolares/oficial",
  blue: "https://dolarapi.com/v1/dolares/blue",
} as const

type DollarType = keyof typeof DOLAR_API_URLS

const normalizeDollarType = (value: string | null): DollarType =>
  value === "blue" ? "blue" : "official"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    let typeParam: string | null = null
    
    // Try to get type from request body first (for POST requests)
    if (req.method === 'POST') {
      try {
        const bodyText = await req.text()
        console.log('📥 Request body raw:', bodyText)
        
        if (bodyText) {
          const body = JSON.parse(bodyText)
          console.log('📥 Request body parsed:', JSON.stringify(body))
          typeParam = typeof body?.type === "string" ? body.type : null
          console.log('📥 Type from body:', typeParam)
        }
      } catch (parseError) {
        console.log('⚠️ Could not parse body:', parseError)
      }
    }
    
    // Fallback to query params
    if (!typeParam) {
      const url = new URL(req.url)
      typeParam = url.searchParams.get("type")
      console.log('📥 Type from query params:', typeParam)
    }

    const dollarType = normalizeDollarType(typeParam)
    const dollarLabel = dollarType === "blue" ? "Dólar blue" : "Dólar oficial"
    const apiUrl = DOLAR_API_URLS[dollarType]
    const settingKey = dollarType === "blue" ? "dollar_blue" : "dollar_official"
    
    console.log(`🔄 Iniciando actualización: ${dollarLabel}`)
    console.log(`🔗 API URL: ${apiUrl}`)
    console.log(`🔑 Setting key: ${settingKey}`)

    // 1. Obtener cotización de API externa
    const response = await fetch(apiUrl)
    if (!response.ok) {
      throw new Error(`Error HTTP al llamar DolarApi: ${response.status}`)
    }
    
    const data = await response.json()
    console.log('📊 Cotización obtenida:', JSON.stringify(data))
    
    // 2. Extraer datos relevantes
    const dollarData = {
      rate: data.venta,
      venta: data.venta,
      compra: data.compra,
      source: 'dolarapi.com',
      fechaActualizacion: data.fechaActualizacion || new Date().toISOString(),
    }

    // 3. Usar service role key para bypasear RLS
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 4. Actualizar settings en la base de datos
    const { error } = await supabaseAdmin
      .from('settings')
      .upsert({
        key: settingKey,
        value: dollarData,
        updated_at: new Date().toISOString(),
      })

    if (error) {
      console.error('❌ Error al guardar en Supabase:', error)
      throw error
    }

    console.log(`✅ ${dollarLabel} actualizado correctamente`)
    console.log(`💵 Nuevo valor: $${dollarData.rate}`)

    return new Response(
      JSON.stringify({ 
        success: true, 
        data: dollarData,
        type: dollarType,
        message: `${dollarLabel} actualizado: $${dollarData.rate}`,
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )

  } catch (err) {
    console.error('Error actualizando dolar:', err)
    
    const errorMessage = err instanceof Error ? err.message : 'Error desconocido'
    const errorDetails = err instanceof Error ? err.toString() : String(err)
    
    return new Response(
      JSON.stringify({ 
        success: false,
        error: errorMessage,
        details: errorDetails,
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    )
  }
})
