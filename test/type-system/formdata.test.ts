import { describe, expect, it } from "bun:test";
import { Elysia, t, type ValidationError } from "../../src";

const variantObject = t.Object({
			price: t.Number({ minimum: 0 }),
			weight: t.Number({ minimum: 0 }),
		})

const metadataObject = {
		category: t.String(),
		tags: t.Array(t.String()),
		inStock: t.Boolean(),
	}

const postProductModel = t.Object({
	name: t.String(),
	variants: t.Array(variantObject),
	metadata: t.Object(metadataObject),
	image: t.File({ type: "image" }),
});
type postProductModel = typeof postProductModel.static;

const patchProductModel = t.Object({
	name: t.Optional(t.String()),
	variants: t.Optional(t.Array(variantObject	),
	),
	metadata: t.Optional(t.Object(metadataObject),),
	image: t.Optional(t.File({ type: "image" })),
});
type patchProductModel = typeof patchProductModel.static;

const postProductModelComplex = t.Object({
	name: t.String(),
	variants: t.ArrayString(variantObject),
	metadata: t.ObjectString(metadataObject),
	image: t.File({ type: "image" }),
});
type postProductModelComplex = typeof postProductModelComplex.static;

const patchProductModelComplex = t.Object({
	name: t.Optional(t.String()),
	variants: t.Optional(t.ArrayString(variantObject	),
	),
	metadata: t.Optional(t.ObjectString(metadataObject),),
	image: t.Optional(t.File({ type: "image" })),
});
type patchProductModelComplex = typeof patchProductModelComplex.static;

const app = new Elysia()
	.post("/product", async ({ body, status }) => status("Created", body), {
		body: postProductModel,
	})
	.patch(
		"/product/:id",
		({ body, params }) => ({
			id: params.id,
			...body,
		}),
		{
			body: patchProductModel,
		},
	)
	.post("/product-complex", async ({ body, status }) => status("Created", body), {
		body: postProductModelComplex,
	})
	.patch(
		"/product-complex/:id",
		({ body, params }) => ({
			id: params.id,
			...body,
		}),
		{
			body: patchProductModelComplex,
		},
	);

describe("Nested FormData with file(s) support", () => {
	describe("Nested FormData with mandatory bunFile (post operation)", async () => {
		const bunFilePath1 = `${import.meta.dir}/../images/aris-yuzu.jpg`;
		const bunFile = Bun.file(bunFilePath1) as File;

		const newProduct: postProductModel = {
			name: "Test Product",
			variants: [
				{
					price: 10,
					weight: 100,
				},
				{
					price: 2.7,
					weight: 32,
				},
			],
			metadata: {
				category: "Electronics",
				tags: ["new", "featured", "sale"],
				inStock: true,
			},
			image: bunFile,
		};

		it("should create a product", async () => {
			const stringifiedVariants = JSON.stringify(newProduct.variants);
			const stringifiedMetadata = JSON.stringify(newProduct.metadata);

			const body = new FormData();
			body.append("name", newProduct.name);
			body.append("variants", stringifiedVariants);
			body.append("metadata", stringifiedMetadata);
			body.append("image", bunFile);

			const response = await app.handle(
				new Request("http://localhost/product", {
					method: "POST",
					body,
				}),
			);
			expect(response.status).toBe(201);
			const data = await response.json();
			expect(data).toEqual(newProduct);
		});

		it("should return validation error on nested ArrayString", async () => {
			const stringifiedVariants = JSON.stringify([
				{
					price: 23,
					waighTypo: "",
				},
			]);
			const stringifiedMetadata = JSON.stringify(newProduct.metadata);

			const body = new FormData();
			body.append("name", newProduct.name);
			body.append("variants", stringifiedVariants);
			body.append("metadata", stringifiedMetadata);
			body.append("image", bunFile);

			const response = await app.handle(
				new Request("http://localhost/product", {
					method: "POST",
					body,
				}),
			);
			const data = (await response.json()) as ValidationError;
			expect(response.status).toBe(422);
			expect(data.type).toBe("validation");
		});

		it("should return validation error on nested ObjectString", async () => {
			const stringifiedVariants = JSON.stringify(newProduct.variants);
			const stringifiedMetadata = JSON.stringify({
				categoryTypo: "Electronics",
				tags: ["new", "featured", "sale"],
				inStock: true,
			});

			const body = new FormData();
			body.append("name", newProduct.name);
			body.append("variants", stringifiedVariants);
			body.append("metadata", stringifiedMetadata);
			body.append("image", bunFile);

			const response = await app.handle(
				new Request("http://localhost/product", {
					method: "POST",
					body,
				}),
			);
			const data = (await response.json()) as ValidationError;
			expect(response.status).toBe(422);
			expect(data.type).toBe("validation");
		});
	});

	describe("Nested FormData with optionnal file (patch operation)", async () => {
		const bunFilePath2 = `${import.meta.dir}/../images/aris-yuzu.jpg`;
		const bunFile = Bun.file(bunFilePath2) as File;

		it("PATCH with bunFile and omitted optional t.ObjectString", async () => {
			const body = new FormData();
			body.append("name", "Updated Product");
			body.append("image", bunFile);
			// metadata and variants fields are omitted (should be OK since they're optional)

			const response = await app.handle(
				new Request("http://localhost/product/123", {
					method: "PATCH",
					body,
				}),
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as patchProductModel;
			expect(data).not.toBeNull();
			expect(data?.name).toBe("Updated Product");
			expect(data?.metadata).toBeUndefined();
			expect(data?.variants).toBeUndefined();
		});

		it("PATCH with file and valid t.ObjectString and t.ArrayString data", async () => {
			const body = new FormData();
			body.append("name", "Updated Product");
			body.append("image", bunFile);
			body.append(
				"metadata",
				JSON.stringify({
					category: "Electronics",
					tags: ["sale", "new"],
					inStock: true,
				}),
			);
			body.append(
				"variants",
				JSON.stringify([
					{
						price: 15,
						weight: 200,
					},
				]),
			);

			const response = await app.handle(
				new Request("http://localhost/product/123", {
					method: "PATCH",
					body,
				}),
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as patchProductModel;
			expect(data).not.toBeNull();
			expect(data?.name).toBe("Updated Product");
			expect(data?.metadata).toEqual({
				category: "Electronics",
				tags: ["sale", "new"],
				inStock: true,
			});
			expect(data?.variants).toEqual([
				{
					price: 15,
					weight: 200,
				},
			]);
		});

		it("PATCH without file and omitted optional t.ObjectString and optional t.ArrayString", async () => {
			const response = await app.handle(
				new Request("http://localhost/product/123", {
					method: "PATCH",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						name: "Updated Product",
					}),
				}),
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as patchProductModel;
			expect(data).not.toBeNull();
			expect(data?.name).toBe("Updated Product");
			expect(data?.image).toBeUndefined();
			expect(data?.metadata).toBeUndefined();
			expect(data?.variants).toBeUndefined();
		});

		it("PATCH should return validation error on invalid ObjectString", async () => {
			const body = new FormData();
			body.append("name", "Updated Product");
			body.append("image", bunFile);
			body.append(
				"metadata",
				JSON.stringify({
					categoryTypo: "Electronics", // Wrong property name
					tags: ["sale"],
					inStock: true,
				}),
			);

			const response = await app.handle(
				new Request("http://localhost/product/123", {
					method: "PATCH",
					body,
				}),
			);

			expect(response.status).toBe(422);
			const data = (await response.json()) as ValidationError;
			expect(data.type).toBe("validation");
		});

		it("PATCH should return validation error on invalid ArrayString", async () => {
			const body = new FormData();
			body.append("name", "Updated Product");
			body.append("image", bunFile);
			body.append(
				"variants",
				JSON.stringify([
					{
						priceTypo: 15, // Wrong property name
						weight: 200,
					},
				]),
			);

			const response = await app.handle(
				new Request("http://localhost/product/123", {
					method: "PATCH",
					body,
				}),
			);

			expect(response.status).toBe(422);
			const data = (await response.json()) as ValidationError;
			expect(data.type).toBe("validation");
		});
	});

	describe("Nested FormData with t.ArrayString and t.ObjectString (POST operation)", async () => {
		const bunFilePath3 = `${import.meta.dir}/../images/aris-yuzu.jpg`;
		const bunFile = Bun.file(bunFilePath3) as File;

		const newProductComplex: postProductModelComplex = {
			name: "Test Product Complex",
			variants: [
				{
					price: 10,
					weight: 100,
				},
				{
					price: 2.7,
					weight: 32,
				},
			],
			metadata: {
				category: "Electronics",
				tags: ["new", "featured", "sale"],
				inStock: true,
			},
			image: bunFile,
		};

		it("should create a product with t.ArrayString and t.ObjectString", async () => {
			const stringifiedVariants = JSON.stringify(newProductComplex.variants);
			const stringifiedMetadata = JSON.stringify(newProductComplex.metadata);

			const body = new FormData();
			body.append("name", newProductComplex.name);
			body.append("variants", stringifiedVariants);
			body.append("metadata", stringifiedMetadata);
			body.append("image", bunFile);

			const response = await app.handle(
				new Request("http://localhost/product-complex", {
					method: "POST",
					body,
				}),
			);
			expect(response.status).toBe(201);
			const data = await response.json();
			expect(data).toEqual(newProductComplex);
		});

		it("should return validation error on invalid t.ArrayString nested structure", async () => {
			const stringifiedVariants = JSON.stringify([
				{
					price: 23,
					weightTypo: 100, // Wrong property name
				},
			]);
			const stringifiedMetadata = JSON.stringify(newProductComplex.metadata);

			const body = new FormData();
			body.append("name", newProductComplex.name);
			body.append("variants", stringifiedVariants);
			body.append("metadata", stringifiedMetadata);
			body.append("image", bunFile);

			const response = await app.handle(
				new Request("http://localhost/product-complex", {
					method: "POST",
					body,
				}),
			);
			const data = (await response.json()) as ValidationError;
			expect(response.status).toBe(422);
			expect(data.type).toBe("validation");
		});

		it("should return validation error on invalid t.ObjectString nested structure", async () => {
			const stringifiedVariants = JSON.stringify(newProductComplex.variants);
			const stringifiedMetadata = JSON.stringify({
				categoryTypo: "Electronics", // Wrong property name
				tags: ["new", "featured", "sale"],
				inStock: true,
			});

			const body = new FormData();
			body.append("name", newProductComplex.name);
			body.append("variants", stringifiedVariants);
			body.append("metadata", stringifiedMetadata);
			body.append("image", bunFile);

			const response = await app.handle(
				new Request("http://localhost/product-complex", {
					method: "POST",
					body,
				}),
			);
			const data = (await response.json()) as ValidationError;
			expect(response.status).toBe(422);
			expect(data.type).toBe("validation");
		});

		it("should return validation error when variants is not a valid JSON string", async () => {
			const stringifiedMetadata = JSON.stringify(newProductComplex.metadata);

			const body = new FormData();
			body.append("name", newProductComplex.name);
			body.append("variants", "not-valid-json");
			body.append("metadata", stringifiedMetadata);
			body.append("image", bunFile);

			const response = await app.handle(
				new Request("http://localhost/product-complex", {
					method: "POST",
					body,
				}),
			);
			const data = (await response.json()) as ValidationError;
			expect(response.status).toBe(422);
			expect(data.type).toBe("validation");
		});

		it("should return validation error when metadata is not a valid JSON string", async () => {
			const stringifiedVariants = JSON.stringify(newProductComplex.variants);

			const body = new FormData();
			body.append("name", newProductComplex.name);
			body.append("variants", stringifiedVariants);
			body.append("metadata", "not-valid-json");
			body.append("image", bunFile);

			const response = await app.handle(
				new Request("http://localhost/product-complex", {
					method: "POST",
					body,
				}),
			);
			const data = (await response.json()) as ValidationError;
			expect(response.status).toBe(422);
			expect(data.type).toBe("validation");
		});
	});

	describe("Nested FormData with optional t.ArrayString and t.ObjectString (PATCH operation)", async () => {
		const bunFilePath4 = `${import.meta.dir}/../images/aris-yuzu.jpg`;
		const bunFile = Bun.file(bunFilePath4) as File;

		it("PATCH with bunFile and omitted optional t.ObjectString and t.ArrayString", async () => {
			const body = new FormData();
			body.append("name", "Updated Product Complex");
			body.append("image", bunFile);
			// metadata and variants fields are omitted (should be OK since they're optional)

			const response = await app.handle(
				new Request("http://localhost/product-complex/456", {
					method: "PATCH",
					body,
				}),
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as patchProductModelComplex;
			expect(data).not.toBeNull();
			expect(data?.name).toBe("Updated Product Complex");
			expect(data?.metadata).toBeUndefined();
			expect(data?.variants).toBeUndefined();
		});

		it("PATCH with file and valid t.ObjectString and t.ArrayString data", async () => {
			const body = new FormData();
			body.append("name", "Updated Product Complex");
			body.append("image", bunFile);
			body.append(
				"metadata",
				JSON.stringify({
					category: "Electronics",
					tags: ["sale", "new"],
					inStock: true,
				}),
			);
			body.append(
				"variants",
				JSON.stringify([
					{
						price: 15,
						weight: 200,
					},
				]),
			);

			const response = await app.handle(
				new Request("http://localhost/product-complex/456", {
					method: "PATCH",
					body,
				}),
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as patchProductModelComplex;
			expect(data).not.toBeNull();
			expect(data?.name).toBe("Updated Product Complex");
			expect(data?.metadata).toEqual({
				category: "Electronics",
				tags: ["sale", "new"],
				inStock: true,
			});
			expect(data?.variants).toEqual([
				{
					price: 15,
					weight: 200,
				},
			]);
		});

		it("PATCH without file and omitted optional fields", async () => {
			const response = await app.handle(
				new Request("http://localhost/product-complex/456", {
					method: "PATCH",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						name: "Updated Product Complex",
					}),
				}),
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as patchProductModelComplex;
			expect(data).not.toBeNull();
			expect(data?.name).toBe("Updated Product Complex");
			expect(data?.image).toBeUndefined();
			expect(data?.metadata).toBeUndefined();
			expect(data?.variants).toBeUndefined();
		});

		it("PATCH should return validation error on invalid t.ObjectString", async () => {
			const body = new FormData();
			body.append("name", "Updated Product Complex");
			body.append("image", bunFile);
			body.append(
				"metadata",
				JSON.stringify({
					categoryTypo: "Electronics", // Wrong property name
					tags: ["sale"],
					inStock: true,
				}),
			);

			const response = await app.handle(
				new Request("http://localhost/product-complex/456", {
					method: "PATCH",
					body,
				}),
			);

			expect(response.status).toBe(422);
			const data = (await response.json()) as ValidationError;
			expect(data.type).toBe("validation");
		});

		it("PATCH should return validation error on invalid t.ArrayString", async () => {
			const body = new FormData();
			body.append("name", "Updated Product Complex");
			body.append("image", bunFile);
			body.append(
				"variants",
				JSON.stringify([
					{
						priceTypo: 15, // Wrong property name
						weight: 200,
					},
				]),
			);

			const response = await app.handle(
				new Request("http://localhost/product-complex/456", {
					method: "PATCH",
					body,
				}),
			);

			expect(response.status).toBe(422);
			const data = (await response.json()) as ValidationError;
			expect(data.type).toBe("validation");
		});

		it("PATCH should return validation error when metadata is not valid JSON", async () => {
			const body = new FormData();
			body.append("name", "Updated Product Complex");
			body.append("image", bunFile);
			body.append("metadata", "invalid-json");

			const response = await app.handle(
				new Request("http://localhost/product-complex/456", {
					method: "PATCH",
					body,
				}),
			);

			expect(response.status).toBe(422);
			const data = (await response.json()) as ValidationError;
			expect(data.type).toBe("validation");
		});

		it("PATCH should return validation error when variants is not valid JSON", async () => {
			const body = new FormData();
			body.append("name", "Updated Product Complex");
			body.append("image", bunFile);
			body.append("variants", "invalid-json");

			const response = await app.handle(
				new Request("http://localhost/product-complex/456", {
					method: "PATCH",
					body,
				}),
			);

			expect(response.status).toBe(422);
			const data = (await response.json()) as ValidationError;
			expect(data.type).toBe("validation");
		});
	});

	describe("Model reference with File and nested Object", () => {
		const bunFilePath5 = `${import.meta.dir}/../images/aris-yuzu.jpg`;
		const bunFile = Bun.file(bunFilePath5) as File;

		it("should coerce nested Object to ObjectString when using model reference", async () => {
			const app = new Elysia()
				.model('userWithAvatar', t.Object({
					name: t.String(),
					avatar: t.File(),
					metadata: t.Object({
						age: t.Number()
					})
				}))
				.post('/user', ({ body }) => body, {
					body: 'userWithAvatar'
				})

			const formData = new FormData()
			formData.append('name', 'John')
			formData.append('avatar', bunFile)
			formData.append('metadata', JSON.stringify({ age: 25 }))

			const response = await app.handle(new Request('http://localhost/user', {
				method: 'POST',
				body: formData
			}))

			expect(response.status).toBe(200)
			const data = await response.json() as any
			expect(data.name).toBe('John')
			expect(data.metadata).toEqual({ age: 25 })
		})
	})
});
