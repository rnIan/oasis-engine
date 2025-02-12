import { DisorderedArray } from "../DisorderedArray";
import { ShaderData } from "../shader";
import { ShadowType } from "../shadow";
import { DirectLight } from "./DirectLight";
import { PointLight } from "./PointLight";
import { SpotLight } from "./SpotLight";

/**
 * Light manager.
 */
export class LightManager {
  /** @internal */
  _spotLights: DisorderedArray<SpotLight> = new DisorderedArray();
  /** @internal */
  _pointLights: DisorderedArray<PointLight> = new DisorderedArray();
  /** @internal */
  _directLights: DisorderedArray<DirectLight> = new DisorderedArray();

  /**
   * @internal
   */
  _attachSpotLight(light: SpotLight): void {
    light._lightIndex = this._spotLights.length;
    this._spotLights.add(light);
  }

  /**
   * @internal
   */
  _detachSpotLight(light: SpotLight): void {
    const replaced = this._spotLights.deleteByIndex(light._lightIndex);
    replaced && (replaced._lightIndex = light._lightIndex);
    light._lightIndex = -1;
  }

  /**
   * @internal
   */
  _attachPointLight(light: PointLight): void {
    light._lightIndex = this._pointLights.length;
    this._pointLights.add(light);
  }

  /**
   * @internal
   */
  _detachPointLight(light: PointLight): void {
    const replaced = this._pointLights.deleteByIndex(light._lightIndex);
    replaced && (replaced._lightIndex = light._lightIndex);
    light._lightIndex = -1;
  }

  /**
   * @internal
   */
  _attachDirectLight(light: DirectLight): void {
    light._lightIndex = this._directLights.length;
    this._directLights.add(light);
  }

  /**
   * @internal
   */
  _detachDirectLight(light: DirectLight): void {
    const replaced = this._directLights.deleteByIndex(light._lightIndex);
    replaced && (replaced._lightIndex = light._lightIndex);
    light._lightIndex = -1;
  }

  /**
   * @internal
   */
  _getSunLightIndex(): number {
    const directLights = this._directLights;

    let sunLightIndex = -1;
    let maxIntensity = Number.NEGATIVE_INFINITY;
    let hasShadowLight = false;
    for (let i = 0, n = directLights.length; i < n; i++) {
      const directLight = directLights.get(i);
      if (directLight.shadowType !== ShadowType.None && !hasShadowLight) {
        maxIntensity = Number.NEGATIVE_INFINITY;
        hasShadowLight = true;
      }
      const intensity = directLight.intensity * directLight.color.getBrightness();
      if (hasShadowLight) {
        if (directLight.shadowType !== ShadowType.None && maxIntensity < intensity) {
          maxIntensity = intensity;
          sunLightIndex = i;
        }
      } else {
        if (maxIntensity < intensity) {
          maxIntensity = intensity;
          sunLightIndex = i;
        }
      }
    }
    return sunLightIndex;
  }

  /**
   * @internal
   */
  _updateShaderData(shaderData: ShaderData): void {
    const spotLight = this._spotLights;
    const pointLight = this._pointLights;
    const directLight = this._directLights;
    const spotLightCount = spotLight.length;
    const pointLightCount = pointLight.length;
    const directLightCount = directLight.length;

    for (let i = 0, len = spotLightCount; i < len; i++) {
      const light = spotLight.get(i);
      light._appendData(i);
    }

    for (let i = 0, len = pointLightCount; i < len; i++) {
      const light = pointLight.get(i);
      light._appendData(i);
    }

    for (let i = 0, len = directLightCount; i < len; i++) {
      const light = directLight.get(i);
      light._appendData(i);
    }

    if (directLightCount) {
      DirectLight._updateShaderData(shaderData);
      shaderData.enableMacro("O3_DIRECT_LIGHT_COUNT", directLightCount.toString());
    } else {
      shaderData.disableMacro("O3_DIRECT_LIGHT_COUNT");
    }

    if (pointLightCount) {
      PointLight._updateShaderData(shaderData);
      shaderData.enableMacro("O3_POINT_LIGHT_COUNT", pointLightCount.toString());
    } else {
      shaderData.disableMacro("O3_POINT_LIGHT_COUNT");
    }

    if (spotLightCount) {
      SpotLight._updateShaderData(shaderData);
      shaderData.enableMacro("O3_SPOT_LIGHT_COUNT", spotLightCount.toString());
    } else {
      shaderData.disableMacro("O3_SPOT_LIGHT_COUNT");
    }
  }
}
