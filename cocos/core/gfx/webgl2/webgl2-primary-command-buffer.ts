/*
 Copyright (c) 2020 Xiamen Yaji Software Co., Ltd.

 https://www.cocos.com/

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated engine source code (the "Software"), a limited,
 worldwide, royalty-free, non-assignable, revocable and non-exclusive license
 to use Cocos Creator solely to develop games on your target platforms. You shall
 not use Cocos Creator software for developing other software or tools that's
 used for developing games. You are not granted to publish, distribute,
 sublicense, and/or sell copies of Cocos Creator.

 The software or tools in this License Agreement are licensed, not sold.
 Xiamen Yaji Software Co., Ltd. reserves all rights not expressly granted to you.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 THE SOFTWARE.
 */

import { Buffer } from '../base/buffer';
import { CommandBuffer } from '../base/command-buffer';
import { BufferUsageBit, BufferTextureCopy, Color, Rect, BufferSource, DrawInfo, Viewport } from '../base/define';
import { Framebuffer } from '../base/framebuffer';
import { InputAssembler } from '../base/input-assembler';
import { Texture } from '../base/texture';
import { WebGL2Buffer } from './webgl2-buffer';
import { WebGL2CommandBuffer } from './webgl2-command-buffer';
import {
    WebGL2CmdFuncBeginRenderPass, WebGL2CmdFuncBindStates, WebGL2CmdFuncCopyBuffersToTexture,
    WebGL2CmdFuncDraw, WebGL2CmdFuncExecuteCmds, WebGL2CmdFuncUpdateBuffer } from './webgl2-commands';
import { WebGL2Framebuffer } from './webgl2-framebuffer';
import { WebGL2Texture } from './webgl2-texture';
import { RenderPass } from '../base/render-pass';
import { WebGL2RenderPass } from './webgl2-render-pass';
import { WebGL2DeviceManager } from './webgl2-define';

export class WebGL2PrimaryCommandBuffer extends WebGL2CommandBuffer {
    public beginRenderPass (
        renderPass: RenderPass,
        framebuffer: Framebuffer,
        renderArea: Rect,
        clearColors: Color[],
        clearDepth: number,
        clearStencil: number,
    ) {
        WebGL2CmdFuncBeginRenderPass(
            WebGL2DeviceManager.instance,
            (renderPass as WebGL2RenderPass).gpuRenderPass,
            (framebuffer as WebGL2Framebuffer).gpuFramebuffer,
            renderArea, clearColors, clearDepth, clearStencil,
        );
        this._isInRenderPass = true;
    }

    public draw (infoOrAssembler: DrawInfo | InputAssembler) {
        if (this._isInRenderPass) {
            if (this._isStateInvalied) {
                this.bindStates();
            }

            const info = 'drawInfo' in infoOrAssembler ? infoOrAssembler.drawInfo : infoOrAssembler;

            WebGL2CmdFuncDraw(WebGL2DeviceManager.instance, info as DrawInfo);

            ++this._numDrawCalls;
            this._numInstances += info.instanceCount;
            const indexCount = info.indexCount || info.vertexCount;
            if (this._curGPUPipelineState) {
                const glPrimitive = this._curGPUPipelineState.glPrimitive;
                switch (glPrimitive) {
                case 0x0004: { // WebGLRenderingContext.TRIANGLES
                    this._numTris += indexCount / 3 * Math.max(info.instanceCount, 1);
                    break;
                }
                case 0x0005: // WebGLRenderingContext.TRIANGLE_STRIP
                case 0x0006: { // WebGLRenderingContext.TRIANGLE_FAN
                    this._numTris += (indexCount - 2) * Math.max(info.instanceCount, 1);
                    break;
                }
                default:
                }
            }
        } else {
            console.error('Command \'draw\' must be recorded inside a render pass.');
        }
    }

    public setViewport (viewport: Viewport) {
        const { stateCache: cache, gl } = WebGL2DeviceManager.instance;

        if (cache.viewport.left !== viewport.left
            || cache.viewport.top !== viewport.top
            || cache.viewport.width !== viewport.width
            || cache.viewport.height !== viewport.height) {
            gl.viewport(viewport.left, viewport.top, viewport.width, viewport.height);

            cache.viewport.left = viewport.left;
            cache.viewport.top = viewport.top;
            cache.viewport.width = viewport.width;
            cache.viewport.height = viewport.height;
        }
    }

    public setScissor (scissor: Rect) {
        const { stateCache: cache, gl } = WebGL2DeviceManager.instance;

        if (cache.scissorRect.x !== scissor.x
            || cache.scissorRect.y !== scissor.y
            || cache.scissorRect.width !== scissor.width
            || cache.scissorRect.height !== scissor.height) {
            gl.scissor(scissor.x, scissor.y, scissor.width, scissor.height);

            cache.scissorRect.x = scissor.x;
            cache.scissorRect.y = scissor.y;
            cache.scissorRect.width = scissor.width;
            cache.scissorRect.height = scissor.height;
        }
    }

    public updateBuffer (buffer: Buffer, data: BufferSource, size?: number) {
        if (!this._isInRenderPass) {
            const gpuBuffer = (buffer as WebGL2Buffer).gpuBuffer;
            if (gpuBuffer) {
                let buffSize: number;
                if (size !== undefined) {
                    buffSize = size;
                } else if (buffer.usage & BufferUsageBit.INDIRECT) {
                    buffSize = 0;
                } else {
                    buffSize = (data as ArrayBuffer).byteLength;
                }

                WebGL2CmdFuncUpdateBuffer(WebGL2DeviceManager.instance, gpuBuffer, data as ArrayBuffer, 0, buffSize);
            }
        } else {
            console.error('Command \'updateBuffer\' must be recorded outside a render pass.');
        }
    }

    public copyBuffersToTexture (buffers: ArrayBufferView[], texture: Texture, regions: BufferTextureCopy[]) {
        if (!this._isInRenderPass) {
            const gpuTexture = (texture as WebGL2Texture).gpuTexture;
            if (gpuTexture) {
                WebGL2CmdFuncCopyBuffersToTexture(WebGL2DeviceManager.instance, buffers, gpuTexture, regions);
            }
        } else {
            console.error('Command \'copyBufferToTexture\' must be recorded outside a render pass.');
        }
    }

    public execute (cmdBuffs: CommandBuffer[], count: number) {
        for (let i = 0; i < count; ++i) {
            // actually they are secondary buffers, the cast here is only for type checking
            const webGL2CmdBuff = cmdBuffs[i] as WebGL2PrimaryCommandBuffer;
            WebGL2CmdFuncExecuteCmds(WebGL2DeviceManager.instance, webGL2CmdBuff.cmdPackage);
            this._numDrawCalls += webGL2CmdBuff._numDrawCalls;
            this._numInstances += webGL2CmdBuff._numInstances;
            this._numTris += webGL2CmdBuff._numTris;
        }
    }

    protected bindStates () {
        WebGL2CmdFuncBindStates(WebGL2DeviceManager.instance, this._curGPUPipelineState, this._curGPUInputAssembler,
            this._curGPUDescriptorSets, this._curDynamicOffsets, this._curDynamicStates);
        this._isStateInvalied = false;
    }
}
