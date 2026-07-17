import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import configRouter from "./config";
import usuariosRouter from "./usuarios";
import categoriasRouter from "./categorias";
import productosRouter from "./productos";
import ventasRouter from "./ventas";
import devolucionesRouter from "./devoluciones";
import cajaRouter from "./caja";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(configRouter);
router.use(usuariosRouter);
router.use(categoriasRouter);
router.use(productosRouter);
router.use(ventasRouter);
router.use(devolucionesRouter);
router.use(cajaRouter);
router.use(dashboardRouter);

export default router;
