/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import * as MRE from "@microsoft/mixed-reality-extension-sdk";
import fetch from "node-fetch";

/*
 * import sync-fix
 */
import { UserSyncFix } from "./sync-fix";

const DEBUG = false;

/**
 * The structure of a grabbable entry in the content pack.
 */
type ArtifactDescriptor = {
	displayName: string;
	resourceName: string;
	resourceId: string;
	attachPoint: string;
	grabbable: boolean;
	rigidBody: boolean;
	scale: {
		x: number;
		y: number;
		z: number;
	};
	rotation: {
		x: number;
		y: number;
		z: number;
	};
	position: {
		x: number;
		y: number;
		z: number;
	};
};

/**
 * The structure of the content pack database.
 */
type ArtifactDatabase = {
	[key: string]: ArtifactDescriptor;
};

// // Load the content pack database.
// // eslint-disable-next-line @typescript-eslint/no-var-requires
// const ArtifactDatabase: ArtifactDatabase = require('../public/hats.json');

//======================================
// Convert a rotation from Unity-style Euler angles to a Quaternion.
// If null or undefined passed in, use a 0 rotation.
//======================================
function Unity2QuaternionRotation(euler: MRE.Vector3Like):
  MRE.Quaternion {
  return euler ? MRE.Quaternion.FromEulerAngles(
    euler.x * MRE.DegreesToRadians,
    euler.y * MRE.DegreesToRadians,
    euler.z * MRE.DegreesToRadians
  ) : new MRE.Quaternion();
}

/*
 * sleep() function
 *
 * Returns a Promise that resolves afer 'ms' milliseconds.  To cause your code to pause for that
 * time, use 'await sleep(ms)' in an async function.
 */
function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

interface BodyTracker {
	foreTrack: MRE.Actor;
	neckTrack: MRE.Actor;
	spinemidTrack: MRE.Actor;
}

/**
 * The main class of this app. All the logic goes here.
 */
export default class Grabbable {
	/*
	 * Declare a SyncFix object
	 * Set to refresh every 5000 ms (5 sec)
	 */
	private syncfix = new UserSyncFix(5000); // sync every 5000 milliseconds

	/*
	 * Track which attachments belongs to which user
	 * NOTE: The MRE.Guid will be the ID of the user.  Maps are more efficient with Guids for keys
	 * than they would be with MRE.Users.
	 */

	private attachments = new Map<MRE.Guid, MRE.Actor[]>();
	private prefabs: { [key: string]: MRE.Prefab } = {};
	private text: MRE.Actor = null;
	private kitItemStylus: MRE.Actor = null;

	// for triggers
	private userTrackers = new Map<MRE.Guid, BodyTracker>();
	private assets: MRE.AssetContainer;

	// For the database of artifacts.
	private artifactDB: ArtifactDatabase;
	private contentPack: string;

	public PI = Math.PI;
	public TAU = Math.PI * 2;

	// private model: MRE.Actor = null;
	// private materials: MRE.Material[] = [];
	// private spamRoot: MRE.Actor;

	private readonly SCALE = 0.2;

	public cleanup() {
		this.assets.unload();
	}

	/* eslint-disable */
	constructor(
		private context: MRE.Context,
		private params: MRE.ParameterSet,
		private baseUrl: string
	) {
		// constructor(private context: MRE.Context, protected baseUrl: string) {
		// eslint-disable-next-line
		console.log("Test");

		this.contentPack = String(
			this.params.cpack || this.params.content_pack
		);

		if (this.contentPack) {
			// Specify a url to a JSON file
			// https://account.altvr.com/content_packs/1187493048011980938
			// e.g. ws://10.0.1.89:3901?content_pack=1187493048011980938
			fetch(
				`https://account.altvr.com/api/content_packs/${this.contentPack}/raw.json`,
				{ method: "Get" }
			)
				.then((response: any) => response.json())
				.then((json: any) => {
					if (DEBUG) {
						console.log(json);
					}
					this.artifactDB = Object.assign({}, json);
					console.log(
						"cpack: ",
						JSON.stringify(this.artifactDB, null, "\t")
					);
					// this.context.onStarted(() => this.started());
					this.started();
				});
		} else {
			this.context.onStarted(() => this.started());
		}
	}

	/* eslint-enable */

	//==========================
	// Synchronization function for attachments
	// Need to detach and reattach every attachment
	//==========================
	private synchronizeAttachments() {
		// Loop through all values in the 'attachments' map
		// The [key, value] syntax breaks each entry of the map into its key and
		// value automatically.  In the case of 'attachments', the key is the
		// Guid of the user and the value is the actor/attachment.

		for (const [userId, userattachments] of this.attachments) {
			//added this looping through attachment array
			// for (const attacheditem of userattachments as Array<MRE.Actor> ) {
			for (const attacheditem of userattachments) {
				// Store the current attachpoint.
				const attachPoint = attacheditem.attachment.attachPoint;

				// Detach from the user
				attacheditem.detach();

				// Reattach to the user
				attacheditem.attach(userId, attachPoint);
			}
		}
	}

	/**
	 * Once the context is "started", initialize the app.
	 */
	private async started() {
		// Check whether code is running in a debuggable watched filesystem
		// environment and if so delay starting the app by 1 second to give
		// the debugger time to detect that the server has restarted and reconnect.
		// The delay value below is in milliseconds so 1000 is a one second delay.
		// You may need to increase the delay or be able to decrease it depending
		// on the speed of your PC.
		const delay = 1000;
		const argv = process.execArgv.join();
		const isDebug = argv.includes("inspect") || argv.includes("debug");

		// set up somewhere to store loaded assets (meshes, textures,
		// animations, gltfs, etc.)
		this.assets = new MRE.AssetContainer(this.context);

		//==========================
		// Set up the synchronization function
		//==========================
		this.syncfix.addSyncFunc(() => this.synchronizeAttachments());

		//=============================
		// Set up a userJoined() callback to attach userTrackers to the Users.
		//=============================
		this.context.onUserJoined((user) => this.userJoined(user));

		//=============================
		// Set up a userLeft() callback to clean up userTrackers as Users leave.
		//=============================
		this.context.onUserLeft((user) => this.userLeft(user));

		// //====================
		// // Call an async function to "pulse" the size of the kit item in a loop.
		// //====================
		// this.rotateActor(this.styleX, this.styleY, this.styleZ);
		// this.fractalize();

		// return true;
		console.log("pepepe  frankenstein");

		// version to use with async code
		if (isDebug) {
			await new Promise((resolve) => setTimeout(resolve, delay));
			await this.startedImpl();
		} else {
			await this.startedImpl();
		}
	}

	// after started

	// use () => {} syntax here to get proper scope binding when called via setTimeout()
	// if async is required, next line becomes private startedImpl = async () => {
	private startedImpl = async () => {
		// Preload all the hat models.
		await this.preloadGLTFs();

		console.log("GLTFs Preloaded");
		this.artyFactory();
	};

	private artyFactory() {
		const artifacts = Object.entries(this.artifactDB);

		artifacts.forEach(([key, value]) => {
			const key1 = key;
			if (key1) {
				console.log(key1);
			}
			const rotation =  value.rotation ? value.rotation : { x: 0, y: 0, z: 0 };
			const scale = value.scale ? value.scale : { x: 1, y: 1, z: 1 };
			const position = value.position ? value.position : { x: 0, y: 1, z: 0 };

			if (value.resourceId) {
				console.log(value.resourceId)
				const placeArtifact = MRE.Actor.CreateFromLibrary(this.context, {
					resourceId: value.resourceId, //holder
					actor: {
						name: value.displayName,
						collider: {
							geometry: { shape: MRE.ColliderType.Auto },
						},
						transform: {
							local: {
								position: position,
								scale: scale,
								rotation: MRE.Quaternion.FromEulerAngles(
									rotation.x * MRE.DegreesToRadians,
									rotation.y * MRE.DegreesToRadians,
									rotation.z * MRE.DegreesToRadians
								),
							},
						},
						// rigidBody: value.rigidBody ? { mass: 0.0, useGravity: false } : {},
						// collisionDetectionMode: "Continuous"
					},
				});

				placeArtifact.created().then(() => {
					console.log("after create");
					if (value.grabbable) {
						console.log("is grabbable");
						placeArtifact.grabbable = true;
					}
	
					if (value.rigidBody) {
						placeArtifact.rigidBody.useGravity = false;
						placeArtifact.rigidBody.detectCollisions = true;
					}
				});			
			}
		});

	}


	/**
	 * Preload all hat resources. This makes instantiating them faster and more efficient.
	 */
	private preloadGLTFs() {
		// Loop over the Content Pack database, preloading each resource.
		// Return a promise of all the in-progress load promises. This
		// allows the caller to wait until all artifacts are done preloading
		// before continuing.
		// ${this.baseUrl}/${hatRecord.resourceName}`)
		// console.log(`baseURL: ${this.baseUrl}`);
		return Promise.all(
			Object.keys(this.artifactDB).map((artId) => {
				const artRecord = this.artifactDB[artId];
				if (artRecord.resourceName) {
					return this.assets
						.loadGltf(`${artRecord.resourceName}`)
						.then((assets) => {
							this.prefabs[artId] = assets.find(
								(a) => a.prefab !== null
							) as MRE.Prefab;
						})
						.catch((e) => MRE.log.error("app", e));
				} else {
					return Promise.resolve();
				}
			})
		);
	}

	//====================================
	// userJoined() -- attach a tracker to each user
	//====================================
	private userJoined(user: MRE.User) {
		//================================
		// Create a new tracker and attach it to the user
		//================================

		// eslint-disable-next-line
		const tracker: MRE.Actor = MRE.Actor.CreatePrimitive(this.assets, {
			// Make the attachment a small box.
			definition: {
				shape: MRE.PrimitiveShape.Box,
				dimensions: { x: 0.1, y: 0.1, z: 0.1 },
			},

			//========================
			// Make the attachment between the eyes and invisible.
			//========================
			actor: {
				attachment: {
					attachPoint: "center-eye",
					userId: user.id,
				},
				appearance: { enabled: false },

				//========================
				// Need to subscribe to 'transform' so trigger will work for everyone.
				// Without the subscription, the trigger will work for just one person.
				//========================
				subscriptions: ["transform"],
			},

			//========================
			// With attachments like this, we don't need to add a rigidBody explicitly.
			//========================
			addCollider: true,
		});

		/*
		 * Let the syncFix know another user has joined.
		 */
		this.syncfix.userJoined();
	}

	//====================================
	// userLeft() -- clean up tracker as users leave
	//====================================
	private userLeft(user: MRE.User) {
		//================================
		// If the user has a tracker, delete it.
		//================================
		// if (this.userTrackers.has(user.id)) {
		// 	const trackers = this.userTrackers.get(user.id);
		// 	trackers.foreTrack.detach();
		// 	trackers.foreTrack.destroy();
		//
		// 	trackers.neckTrack.detach();
		// 	trackers.neckTrack.destroy();
		//


		if (this.attachments.has(user.id)) {
			const userattachments: MRE.Actor[] = this.attachments.get(user.id);

			//added this looping through attachment array
			for (const attacheditem of userattachments) {
				// Detach the Actor from the user
				attacheditem.detach();

				// Destroy the Actor.
				attacheditem.destroy();
			}
			// Remove the attachment from the 'attachments' map.
			this.attachments.delete(user.id);
		}
	}
}