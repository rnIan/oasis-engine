import { Vector2, Vector3 } from "@oasis-engine/math";
import { SpriteMask } from "../2d";
import { Background } from "../Background";
import { Camera } from "../Camera";
import { DisorderedArray } from "../DisorderedArray";
import { Engine } from "../Engine";
import { BackgroundMode } from "../enums/BackgroundMode";
import { BackgroundTextureFillMode } from "../enums/BackgroundTextureFillMode";
import { CameraClearFlags } from "../enums/CameraClearFlags";
import { Layer } from "../Layer";
import { Material } from "../material";
import { RenderQueueType } from "../shader/enums/RenderQueueType";
import { Shader } from "../shader/Shader";
import { ShaderMacroCollection } from "../shader/ShaderMacroCollection";
import { CascadedShadowCasterPass } from "../shadow/CascadedShadowCasterPass";
import { ShadowType } from "../shadow/enum/ShadowType";
import { RenderTarget, TextureCubeFace } from "../texture";
import { RenderContext } from "./RenderContext";
import { RenderElement } from "./RenderElement";
import { RenderPass } from "./RenderPass";
import { RenderQueue } from "./RenderQueue";

/**
 * Basic render pipeline.
 */
export class BasicRenderPipeline {
  private static _tempVector0 = new Vector3();
  private static _tempVector1 = new Vector3();

  /** @internal */
  _opaqueQueue: RenderQueue;
  /** @internal */
  _transparentQueue: RenderQueue;
  /** @internal */
  _alphaTestQueue: RenderQueue;
  /** @internal */
  _allSpriteMasks: DisorderedArray<SpriteMask> = new DisorderedArray();

  private _camera: Camera;
  private _defaultPass: RenderPass;
  private _renderPassArray: Array<RenderPass>;
  private _lastCanvasSize = new Vector2();
  private _cascadedShadowCaster: CascadedShadowCasterPass;

  /**
   * Create a basic render pipeline.
   * @param camera - Camera
   */
  constructor(camera: Camera) {
    this._camera = camera;
    const { engine } = camera;
    this._opaqueQueue = new RenderQueue(engine);
    this._alphaTestQueue = new RenderQueue(engine);
    this._transparentQueue = new RenderQueue(engine);
    this._cascadedShadowCaster = new CascadedShadowCasterPass(camera);

    this._renderPassArray = [];
    this._defaultPass = new RenderPass("default", 0, null, null, 0);
    this.addRenderPass(this._defaultPass);
  }

  /**
   * Default render pass.
   */
  get defaultRenderPass() {
    return this._defaultPass;
  }

  /**
   * Add render pass.
   * @param nameOrPass - The name of this Pass or RenderPass object. When it is a name, the following parameters need to be provided
   * @param priority - Priority, less than 0 before the default pass, greater than 0 after the default pass
   * @param renderTarget - The specified Render Target
   * @param replaceMaterial -  Replaced material
   * @param mask - Perform bit and operations with Entity.Layer to filter the objects that this Pass needs to render
   */
  addRenderPass(
    nameOrPass: string | RenderPass,
    priority: number = null,
    renderTarget: RenderTarget = null,
    replaceMaterial: Material = null,
    mask: Layer = null
  ) {
    if (typeof nameOrPass === "string") {
      const renderPass = new RenderPass(nameOrPass, priority, renderTarget, replaceMaterial, mask);
      this._renderPassArray.push(renderPass);
    } else if (nameOrPass instanceof RenderPass) {
      this._renderPassArray.push(nameOrPass);
    }

    this._renderPassArray.sort(function (p1, p2) {
      return p1.priority - p2.priority;
    });
  }

  /**
   * Remove render pass by name or render pass object.
   * @param nameOrPass - Render pass name or render pass object
   */
  removeRenderPass(nameOrPass: string | RenderPass): void {
    let pass: RenderPass;
    if (typeof nameOrPass === "string") pass = this.getRenderPass(nameOrPass);
    else if (nameOrPass instanceof RenderPass) pass = nameOrPass;
    if (pass) {
      const idx = this._renderPassArray.indexOf(pass);
      this._renderPassArray.splice(idx, 1);
    }
  }

  /**
   * Get render pass by name.
   * @param  name - Render pass name
   */
  getRenderPass(name: string) {
    for (let i = 0, len = this._renderPassArray.length; i < len; i++) {
      const pass = this._renderPassArray[i];
      if (pass.name === name) return pass;
    }

    return null;
  }

  /**
   * Destroy internal resources.
   */
  destroy(): void {
    this._opaqueQueue.destroy();
    this._alphaTestQueue.destroy();
    this._transparentQueue.destroy();
    this._allSpriteMasks = null;
    this._renderPassArray = null;
    this._defaultPass = null;
    this._camera = null;
  }

  /**
   * Perform scene rendering.
   * @param context - Render context
   * @param cubeFace - Render surface of cube texture
   * @param mipLevel - Set mip level the data want to write
   */
  render(context: RenderContext, cubeFace?: TextureCubeFace, mipLevel?: number) {
    const camera = this._camera;
    const scene = camera.scene;
    const opaqueQueue = this._opaqueQueue;
    const alphaTestQueue = this._alphaTestQueue;
    const transparentQueue = this._transparentQueue;

    camera.engine._spriteMaskManager.clear();
    if (scene.castShadows && scene._sunLight?.shadowType !== ShadowType.None) {
      this._cascadedShadowCaster._render(context);
    }
    opaqueQueue.clear();
    alphaTestQueue.clear();
    transparentQueue.clear();
    this._allSpriteMasks.length = 0;

    context.applyViewProjectMatrix(camera.viewMatrix, camera.projectionMatrix, camera._viewProjectionMatrix);

    this._callRender(context);
    opaqueQueue.sort(RenderQueue._compareFromNearToFar);
    alphaTestQueue.sort(RenderQueue._compareFromNearToFar);
    transparentQueue.sort(RenderQueue._compareFromFarToNear);

    for (let i = 0, len = this._renderPassArray.length; i < len; i++) {
      this._drawRenderPass(context, this._renderPassArray[i], camera, cubeFace, mipLevel);
    }
  }

  private _drawRenderPass(
    context: RenderContext,
    pass: RenderPass,
    camera: Camera,
    cubeFace?: TextureCubeFace,
    mipLevel?: number
  ) {
    pass.preRender(camera, this._opaqueQueue, this._alphaTestQueue, this._transparentQueue);

    if (pass.enabled) {
      const { engine, scene } = camera;
      const { background } = scene;
      const rhi = engine._hardwareRenderer;
      const renderTarget = camera.renderTarget || pass.renderTarget;
      rhi.activeRenderTarget(renderTarget, camera.viewport, mipLevel);
      renderTarget?._setRenderTargetInfo(cubeFace, mipLevel);
      const clearFlags = pass.clearFlags ?? camera.clearFlags;
      const color = pass.clearColor ?? background.solidColor;
      if (clearFlags !== CameraClearFlags.None) {
        rhi.clearRenderTarget(camera.engine, clearFlags, color);
      }

      if (pass.renderOverride) {
        pass.render(camera, this._opaqueQueue, this._alphaTestQueue, this._transparentQueue);
      } else {
        this._opaqueQueue.render(camera, pass.replaceMaterial, pass.mask, null);
        this._alphaTestQueue.render(camera, pass.replaceMaterial, pass.mask, null);
        if (camera.clearFlags & CameraClearFlags.Color) {
          if (background.mode === BackgroundMode.Sky) {
            background.sky._render(context);
          } else if (background.mode === BackgroundMode.Texture && background.texture) {
            this._drawBackgroundTexture(engine, background);
          }
        }
        this._transparentQueue.render(camera, pass.replaceMaterial, pass.mask, null);
      }

      renderTarget?._blitRenderTarget();
      renderTarget?.generateMipmaps();
    }

    pass.postRender(camera, this._opaqueQueue, this._alphaTestQueue, this._transparentQueue);
  }

  /**
   * Push a render element to the render queue.
   * @param element - Render element
   */
  pushPrimitive(element: RenderElement): void {
    switch (element.renderState.renderQueueType) {
      case RenderQueueType.Transparent:
        this._transparentQueue.pushPrimitive(element);
        break;
      case RenderQueueType.AlphaTest:
        this._alphaTestQueue.pushPrimitive(element);
        break;
      case RenderQueueType.Opaque:
        this._opaqueQueue.pushPrimitive(element);
        break;
    }
  }

  private _drawBackgroundTexture(engine: Engine, background: Background) {
    const rhi = engine._hardwareRenderer;
    const { _backgroundTextureMaterial, canvas } = engine;
    const mesh = background._mesh;

    if (
      (this._lastCanvasSize.x !== canvas.width || this._lastCanvasSize.y !== canvas.height) &&
      background._textureFillMode !== BackgroundTextureFillMode.Fill
    ) {
      this._lastCanvasSize.set(canvas.width, canvas.height);
      background._resizeBackgroundTexture();
    }

    const program = _backgroundTextureMaterial.shader.passes[0]._getShaderProgram(engine, Shader._compileMacros);
    program.bind();
    program.uploadAll(program.materialUniformBlock, _backgroundTextureMaterial.shaderData);
    program.uploadUnGroupTextures();

    _backgroundTextureMaterial.renderState._apply(engine, false);
    rhi.drawPrimitive(mesh, mesh.subMesh, program);
  }

  private _callRender(context: RenderContext): void {
    const renderers = this._camera.engine._componentsManager._renderers;
    const camera = context.camera;
    const elements = renderers._elements;
    for (let i = renderers.length - 1; i >= 0; --i) {
      const renderer = elements[i];

      // filter by camera culling mask.
      if (!(camera.cullingMask & renderer._entity.layer)) {
        continue;
      }

      // filter by camera frustum.
      if (camera.enableFrustumCulling) {
        renderer.isCulled = !camera._frustum.intersectsBox(renderer.bounds);
        if (renderer.isCulled) {
          continue;
        }
      }

      const transform = camera.entity.transform;
      const position = transform.worldPosition;
      const center = renderer.bounds.getCenter(BasicRenderPipeline._tempVector0);
      if (camera.isOrthographic) {
        const forward = transform.getWorldForward(BasicRenderPipeline._tempVector1);
        Vector3.subtract(center, position, center);
        renderer._distanceForSort = Vector3.dot(center, forward);
      } else {
        renderer._distanceForSort = Vector3.distanceSquared(center, position);
      }

      renderer._updateShaderData(context);
      renderer._render(context);

      // union camera global macro and renderer macro.
      ShaderMacroCollection.unionCollection(
        camera._globalShaderMacro,
        renderer.shaderData._macroCollection,
        renderer._globalShaderMacro
      );
    }
  }
}
