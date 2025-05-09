# **Best Practices**  

Elysia is a **pattern-agnostic framework**, allowing developers to choose the coding patterns that best suit their needs.  

However, implementing the **MVC (Model-View-Controller) pattern** in Elysia can be challenging due to **difficulties in decoupling logic** and **handling types effectively**.  

This guide outlines **best practices** for structuring an Elysia application while maintaining flexibility in adopting other coding styles.  

---

## **Method Chaining**  

Elysia code should always follow **method chaining** to maintain type integrity.  

Since Elysia’s **type system is dynamic**, each method **returns a new type reference**. Using method chaining ensures proper **type inference**, preventing type-related issues.  

✅ **Recommended Approach (Method Chaining):**  
```typescript
import { Elysia } from 'elysia'

new Elysia()
    .state('build', 1)
    // The store is strictly typed
    .get('/', ({ store: { build } }) => build)
    .listen(3000)
```  
Here, `.state('build', 1)` modifies the `ElysiaInstance` type, ensuring `build` is correctly inferred.  

❌ **Avoid This (No Method Chaining):**  
```typescript
import { Elysia } from 'elysia'

const app = new Elysia()
app.state('build', 1) // Type information is lost

app.get('/', ({ store: { build } }) => build) // ❌ Property 'build' does not exist
app.listen(3000)
```  
### **Why?**  
Without method chaining, Elysia **does not retain new types**, leading to incorrect type inference.  

---

## **Controllers**  

**One Elysia instance should act as one controller.**  

Passing an entire `Context` object to a separate controller can cause issues:  
- **Increased complexity** – Elysia’s types are dynamic and change based on plugins and method chaining.  
- **Typing difficulties** – Elysia’s type system evolves with decorators and state.  
- **Inconsistent type casting** – Manually casting types can break type consistency between definitions and runtime behavior.  

❌ **Avoid Using a Separate Controller Class:**  
```typescript
import { Elysia, type Context } from 'elysia'

abstract class Controller {
    static root(context: Context) {
        return Service.doStuff(context.stuff)
    }
}

// ❌ This adds unnecessary complexity
new Elysia()
    .get('/', Controller.root)
```  
### **Why?**  
Using a full controller method **introduces an extra controller layer**, which complicates type inference.  

✅ **Recommended Approach (Treat Elysia as the Controller):**  
```typescript
import { Elysia } from 'elysia'
import { Service } from './service'

new Elysia()
    .get('/', ({ stuff }) => Service.doStuff(stuff))
```
This approach maintains **type safety, simplicity, and clarity**.  

---

## **Services**  

A **service** in Elysia is a set of **utility/helper functions** that separate business logic from the main controller.  

Elysia supports **two types of services**:  
1. **Non-request dependent services** – Functions that do not require request properties.  
2. **Request-dependent services** – Functions that rely on request-specific data.  

✅ **Example of a Non-Request Dependent Service:**  
```typescript
import { Elysia } from 'elysia'

abstract class Service {
    static fibo(n: number): number {
        return n < 2 ? n : Service.fibo(n - 1) + Service.fibo(n - 2)
    }
}

new Elysia()
    .get('/fibo', ({ body }) => Service.fibo(body), {
        body: t.Numeric()
    })
```
### **Why?**  
If a service **does not need stored properties**, using an **abstract class with static methods** prevents unnecessary instantiation.  