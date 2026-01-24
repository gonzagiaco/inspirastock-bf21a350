import Header from "@/components/Header";
import {
  CircleHelp,
  Database,
  FileDown,
  FileSpreadsheet,
  FileText,
  Info,
  Package,
  Search,
  Settings,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useIsMobile } from "@/hooks/use-mobile";

const Ayuda = () => {
  const isMobile = useIsMobile();

  return (
    <div className="flex-1 p-4 pt-11 lg:px-4 lg:py-10">
      <Header
        title="Ayuda"
        subtitle="¿Necesitas asistencia?"
        showSearch={false}
        icon={<CircleHelp className="h-8 w-8 text-primary" />}
      />

      <div className="space-y-6">
        {/* Configuración de Proveedores */}
        <div className="glassmorphism rounded-xl shadow-lg p-6 space-y-4 w-full">
          <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Database className="h-6 w-6" />
            Configuración de Proveedores
          </h2>
          <p className="text-muted-foreground text-sm">
            Gestiona tus proveedores, listas de productos y cómo se interpretan sus columnas.
          </p>

          <div className="space-y-3">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Configuración de columnas en listas
            </h3>
            <p className="text-muted-foreground text-sm">
              Configura cómo se interpretan las columnas de tus archivos (Excel/CSV/PDF/DOCX):
            </p>
            <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
              <li>
                Ve a <strong>Proveedores</strong> y selecciona un proveedor.
              </li>
              <li>Elige la lista de productos que querés configurar.</li>
              <li>
                Presioná <strong>&quot;Configurar lista&quot;</strong>.
              </li>
              <li>
                En <strong>Columnas</strong> seleccioná los campos para <strong>código</strong>,{" "}
                <strong>nombre/descripción</strong>, <strong>cantidad</strong> y <strong>precio</strong>.
              </li>
              <li>
                En <strong>Precios</strong> podés definir columnas de precio principal, alternativas y crear{" "}
                <strong>columnas personalizadas</strong> (calculadas).
              </li>
              <li>
                En <strong>Opciones</strong> seleccioná qué columna se usará como{" "}
                <strong>precio para el carrito</strong> y como <strong>precio para remitos</strong>.
              </li>
              <li>
                Guardá: el sistema actualiza el índice de búsqueda y deja la lista lista para usar online y offline.
              </li>
            </ol>

            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>Columnas personalizadas (Calculadas)</AlertTitle>
              <AlertDescription>
                En la pestaña <strong>Precios</strong> podés crear columnas nuevas que se calculan a partir de otra
                columna (por ejemplo: costo + margen + IVA). Estas columnas aparecen como{" "}
                <strong>&quot;(Calculada)&quot;</strong> y se pueden usar como precio del carrito o precio para remitos.
              </AlertDescription>
            </Alert>
          </div>
        </div>

        {/* Columnas personalizadas */}
        <div className="glassmorphism rounded-xl shadow-lg p-6 space-y-4">
          <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Settings className="h-6 w-6" />
            Columnas personalizadas (Calculadas)
          </h2>
          <p className="text-muted-foreground text-sm">
            Sirven para crear precios derivados sin modificar el archivo original. Ejemplo: &quot;PRECIO COSTO + 30%
            + IVA&quot;.
          </p>

          <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
            <li>
              <strong>Dónde se crean:</strong> Proveedores → Configurar lista → <strong>Precios</strong>.
            </li>
            <li>
              <strong>Base:</strong> elegís una columna numérica (o una calculada existente) como base.
            </li>
            <li>
              <strong>Porcentaje:</strong> se aplica como descuento/adición sobre la base.
            </li>
            <li>
              <strong>IVA:</strong> opcional, con tasa configurable (por defecto 21%).
            </li>
            <li>
              <strong>Renombrar:</strong> si renombrás una columna calculada, el sistema intenta mantener las referencias
              y también actualiza las selecciones de precio (carrito/remitos) si apuntaban a esa columna.
            </li>
            <li>
              <strong>Uso:</strong> podés seleccionar una columna calculada como precio para carrito o para remitos.
            </li>
          </ul>

          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>Tip</AlertTitle>
            <AlertDescription>
              Si una columna calculada depende de otra calculada, el sistema resuelve la cadena de dependencias. Si
              falta algún dato, usa el mejor fallback disponible.
            </AlertDescription>
          </Alert>
        </div>

        {/* Mi Stock */}
        <div className="glassmorphism rounded-xl shadow-lg p-6 space-y-4">
          <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Package className="h-6 w-6" />
            Mi Stock
          </h2>
          <p className="text-muted-foreground text-sm">
            Mi Stock es tu catálogo personal con cantidades y alertas.
          </p>

          <div className="space-y-3">
            <h3 className="text-lg font-semibold">Qué podés hacer</h3>
            <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
              <li>
                <strong>Filtrar por proveedor</strong> y buscar por código/nombre.
              </li>
              <li>
                <strong>Ver solo con stock</strong> para ocultar productos en 0.
              </li>
              <li>
                <strong>Actualizar cantidades</strong> de forma rápida (edición directa).
              </li>
              <li>
                <strong>Configurar stock mínimo</strong> por producto (alerta de bajo stock).
              </li>
              <li>
                <strong>Quitar productos</strong> de Mi Stock si ya no querés seguirlos.
              </li>
              <li>
                <strong>Armar carrito de pedidos</strong> desde Mi Stock y exportar pedidos por proveedor.
              </li>
            </ul>
          </div>

          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>Precios del carrito</AlertTitle>
            <AlertDescription>
              El subtotal y total del carrito usan la columna seleccionada en{" "}
              <strong>&quot;Columna de Precio para Carrito&quot;</strong> en la configuración de la lista. Si no se
              selecciona, se usa la <strong>columna de precio principal</strong>.
            </AlertDescription>
          </Alert>
        </div>

        {/* Configuración */}
        <div className="glassmorphism rounded-xl shadow-lg p-6 space-y-4">
          <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Settings className="h-6 w-6" />
            Configuración
          </h2>
          <p className="text-muted-foreground text-sm">
            Ajustes generales y automatizaciones.
          </p>
          <div className="space-y-3">
            <h3 className="text-lg font-semibold">Bajo stock y carrito</h3>
            <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
              <li>
                <strong>Auto agregar bajo stock al carrito:</strong> si activás esta opción, los productos por debajo del
                umbral se agregan automáticamente al carrito.
              </li>
              <li>
                <strong>Botón &quot;Agregar bajo stock al carrito&quot;:</strong> agrega en un solo paso los productos
                que estén bajo el mínimo configurado.
              </li>
            </ul>
          </div>
        </div>

        {/* Operaciones múltiples */}
        <div className="glassmorphism rounded-xl shadow-lg p-6 space-y-4">
          <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
            <FileSpreadsheet className="h-6 w-6" />
            Operaciones múltiples
          </h2>
          <p className="text-muted-foreground text-sm">
            Podés aplicar acciones masivas sobre filas o columnas seleccionadas.
          </p>

          <div className="space-y-3">
            <h3 className="text-lg font-semibold">Acciones disponibles</h3>
            <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
              <li>
                <strong>Agregar a Mi Stock:</strong> incorpora los productos seleccionados a tu stock.
              </li>
              <li>
                <strong>Conversión de dólar por fila/columna:</strong> convierte precios usando el dólar configurado y
                permite <strong>revertir</strong> la conversión si es necesario.
              </li>
              <li>
                <strong>Quitar de Mi Stock:</strong> elimina los productos seleccionados de tu stock.
              </li>
              <li>
                <strong>Eliminar fila:</strong> borra productos seleccionados.
              </li>
              <li>
                <strong>Eliminar columnas:</strong> elimina columnas seleccionadas de la lista.
              </li>
            </ul>
          </div>

          <div className="space-y-3">
            <h3 className="text-lg font-semibold">Atajos de selección</h3>
            <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
              <li>
                <strong>Ctrl + clic izquierdo:</strong> selecciona varias filas o columnas de forma individual.
              </li>
              <li>
                <strong>Shift + clic izquierdo:</strong> selecciona un rango continuo entre dos filas o columnas.
              </li>
            </ul>
          </div>
        </div>

        {/* Búsqueda */}
        <div className="glassmorphism rounded-xl shadow-lg p-6 space-y-4">
          <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Search className="h-6 w-6" />
            Búsqueda de Productos
          </h2>
          <p className="text-muted-foreground text-sm">
            La búsqueda funciona tanto online como offline sobre los datos sincronizados.
          </p>
          <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
            <li>
              Buscá por <strong>código</strong>, <strong>nombre</strong> o por campos extra configurados como índice.
            </li>
            <li>
              Si configuraste múltiples variantes de columnas (por ejemplo, distintas descripciones), el sistema usa la
              primera disponible.
            </li>
            <li>
              Si una lista tiene columnas calculadas, el sistema puede resolver esos valores desde los datos ya
              calculados o mediante la fórmula.
            </li>
          </ul>
        </div>

        {/* Exportación */}
        <div className="glassmorphism rounded-xl shadow-lg p-6 space-y-4">
          <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
            <FileDown className="h-6 w-6" />
            Exportación de pedidos
          </h2>
          <p className="text-muted-foreground text-sm">Exportá tus pedidos agrupados por proveedor:</p>
          <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
            <li>Agregá productos al carrito desde Stock o Mi Stock.</li>
            <li>Revisá cantidades en el carrito.</li>
            <li>
              Hacé clic en <strong>&quot;Exportar pedidos&quot;</strong>.
            </li>
            <li>Se generan archivos Excel separados por proveedor.</li>
          </ol>
        </div>

        {/* Remitos */}
        <div className="glassmorphism rounded-xl shadow-lg p-6 space-y-4">
          <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
            <FileText className="h-6 w-6" />
            Gestión de Remitos
          </h2>
          <p className="text-muted-foreground text-sm">
            Los remitos permiten registrar entregas y gestionar stock automáticamente.
          </p>

          <div className="space-y-3">
            <h3 className="text-lg font-semibold">Crear un remito</h3>
            <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
              <li>
                Ve a <strong>Remitos</strong> y hacé clic en <strong>&quot;Nuevo Remito&quot;</strong>.
              </li>
              <li>Completá datos del cliente (nombre, dirección, teléfono).</li>
              <li>Buscá y agregá productos con el buscador.</li>
              <li>Ajustá cantidades según la entrega.</li>
              <li>Indicá monto pagado (opcional) y agregá notas.</li>
            </ol>
          </div>

          <div className="space-y-3">
            <h3 className="text-lg font-semibold">Precios en remitos</h3>
            <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
              <li>
                El precio usado en remitos se define en Proveedores → Configurar lista →{" "}
                <strong>&quot;Columna de Precio para Remitos&quot;</strong>.
              </li>
              <li>
                Si cambiás la columna, al editar un remito existente, el sistema permite que convivan precios viejos y
                nuevos (se suman como líneas separadas por precio).
              </li>
            </ul>
          </div>
        </div>

        {/* Online / Offline */}
        <div className="glassmorphism rounded-xl shadow-lg p-6 space-y-4">
          <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Wifi className="h-6 w-6 text-green-600" />
            <WifiOff className="h-6 w-6 text-orange-600" />
            Online / Offline
          </h2>
          <p className="text-muted-foreground text-sm">
            La app soporta trabajo offline con sincronización automática cuando vuelve la conexión.
          </p>
          <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
            <li>
              <strong>Offline:</strong> podés consultar listas sincronizadas, buscar productos, trabajar con Mi Stock y
              gestionar remitos (se guardan cambios localmente).
            </li>
            <li>
              <strong>Online:</strong> todo se sincroniza en el momento con la nube.
            </li>
            <li>
              <strong>Operaciones pendientes:</strong> si hiciste cambios offline, se encolan y se ejecutan al volver
              online.
            </li>
            <li>
              <strong>Acciones que suelen requerir conexión:</strong> importar/actualizar listas desde archivos y subir
              PDFs a la nube para compartir.
            </li>
          </ul>

          {!isMobile && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>Recomendación</AlertTitle>
              <AlertDescription>
                Si vas a trabajar sin conexión, entrá antes a tus listas principales para que queden sincronizadas en el
                dispositivo.
              </AlertDescription>
            </Alert>
          )}
        </div>

        {/* Contacto */}
        <div className="glassmorphism rounded-xl shadow-lg p-6 text-center">
          <h2 className="text-xl font-bold text-foreground mb-2">¿Necesitás más ayuda?</h2>
          <p className="text-muted-foreground text-sm">
            Si tenés alguna consulta adicional o necesitás soporte técnico, contactanos.
          </p>
        </div>

        <a
          href="https://www.inspirawebstudio.com"
          target="_blank"
          rel="noopener noreferrer"
          className="flex flex-col md:flex-row items-center gap-1"
        >
          <img src="LogoTransparente.png" width={35} alt="" />
          <p className="text-xs md:text-lg">Inspira Web Studio | Todos los derechos reservados.</p>
        </a>
      </div>
    </div>
  );
};

export default Ayuda;
